use std::collections::{HashMap, HashSet};

use parking_lot::Mutex;
use serde_json::Value;
use sqlx::mysql::{MySqlPool, MySqlPoolOptions, MySqlRow, MySqlConnectOptions, MySqlSslMode};
use sqlx::{Executor, MySql, Row, ConnectOptions, Connection};

use crate::drivers::dialect::{
  assert_ident, assert_safe_where, clamp_page_size, quote_mysql_ident, quote_mysql_table,
};
use crate::drivers::util::json_from_mysql_row;
use crate::types::{
  ColumnInfo, ConnectionConfig, CopyTableRequest, DatabaseInfo, DeleteRowsRequest,
  DropDatabaseRequest, DropTableRequest, ExplainPlanMetric, ExplainSQLResult, IndexInfo,
  InsertRowRequest, QueryRowsRequest, QueryRowsResult, RenameTableRequest, TableSchema,
  TruncateTableRequest, UpdateRowRequest,
};

const SYSTEM_DATABASES: &[&str] = &["information_schema", "performance_schema", "mysql", "sys"];

pub struct MysqlDriver {
  pub(super) connection: ConnectionConfig,
  local_port: Option<u16>,
  pools: Mutex<HashMap<String, MySqlPool>>,
  schemas: Mutex<HashMap<(String, String), (std::time::Instant, TableSchema)>>,
}

impl MysqlDriver {
  pub async fn open(connection: ConnectionConfig, local_port: Option<u16>) -> Result<Self, String> {
    Ok(Self {
      connection,
      local_port,
      pools: Mutex::new(HashMap::new()),
      schemas: Mutex::new(HashMap::new()),
    })
  }

  fn host_port(&self) -> (String, u16) {
    if let Some(port) = self.local_port {
      ("127.0.0.1".into(), port)
    } else {
      (self.connection.host.clone(), self.connection.port)
    }
  }

  fn connect_options(&self, database: &str) -> Result<MySqlConnectOptions, String> {
    let (host, port) = self.host_port();
    let (username, password) = super::connection_options::credentials(&self.connection, database);
    let verified = super::connection_options::verified_tls(&self.connection, self.local_port)?;
    let mut options = MySqlConnectOptions::new().host(&host).port(port).username(username)
      .ssl_mode(if verified { MySqlSslMode::VerifyIdentity } else { MySqlSslMode::Disabled });
    if !password.is_empty() { options = options.password(password); }
    if !database.is_empty() { options = options.database(database); }
    if verified {
      if let Some(pem) = self.connection.tls_ca_pem.as_ref().filter(|pem| !pem.trim().is_empty()) {
        options = options.ssl_ca_from_pem(pem.as_bytes().to_vec());
      }
    }
    Ok(options)
  }

  async fn pool(&self, database: &str) -> Result<MySqlPool, String> {
    {
      let guard = self.pools.lock();
      if let Some(pool) = guard.get(database) {
        return Ok(pool.clone());
      }
    }
    let options = self.connect_options(database)?;
    let pool = MySqlPoolOptions::new()
      .max_connections(5)
      .acquire_timeout(std::time::Duration::from_secs(15))
      .after_connect(|connection, _| Box::pin(async move {
        let version: String = sqlx::query_scalar("SELECT VERSION()").fetch_one(&mut *connection).await?;
        if version.to_ascii_lowercase().contains("mariadb") {
          sqlx::query("SET SESSION max_statement_time = 60").execute(&mut *connection).await?;
        } else {
          let major = version.split('.').next().and_then(|n| n.parse::<u32>().ok()).unwrap_or(0);
          let minor = version.split('.').nth(1).and_then(|n| n.parse::<u32>().ok()).unwrap_or(0);
          if major > 5 || (major == 5 && minor >= 7) {
            sqlx::query("SET SESSION max_execution_time = 60000").execute(&mut *connection).await?;
          }
        }
        Ok(())
      }))
      .connect_with(options)
      .await
      .map_err(|e| format!("MySQL connect failed: {e}"))?;
    self.pools.lock().insert(database.to_string(), pool.clone());
    Ok(pool)
  }

  pub(super) async fn validate_import_session(&self, connection: &mut sqlx::MySqlConnection) -> Result<(), String> {
    let mode: String = sqlx::query_scalar("SELECT @@SESSION.sql_mode").fetch_one(connection).await.map_err(|e| e.to_string())?;
    if mode.split(',').any(|part| matches!(part.trim().to_ascii_uppercase().as_str(), "NO_BACKSLASH_ESCAPES" | "ANSI_QUOTES")) {
      return Err("SQL import does not support NO_BACKSLASH_ESCAPES or ANSI_QUOTES session modes. Use a native database client or restore standard SQL modes first.".into());
    }
    Ok(())
  }

  /// Cancellation uses a separate same-account connection: it must not queue
  /// behind this pool's busy connections. The data socket is also discarded.
  pub async fn acquire_active(&self, database: &str) -> Result<super::connection_options::ActiveConnection<MySql>, String> {
    let mut active = super::connection_options::ActiveConnection::new(self.acquire(database).await?);
    let session_id: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()").fetch_one(&mut *active).await.map_err(|e| e.to_string())?;
    let options = self.connect_options(database)?;
    active.on_cancel(move || {
      if let Ok(runtime) = tokio::runtime::Handle::try_current() {
        runtime.spawn(async move {
          let cancel = async {
            let mut control = options.connect().await?;
            let result = sqlx::query(&format!("KILL QUERY {session_id}")).execute(&mut control).await.map(|_| ());
            let _ = control.close().await;
            result
          };
          let _ = tokio::time::timeout(std::time::Duration::from_secs(5), cancel).await;
        });
      }
    });
    Ok(active)
  }

  async fn server_pool(&self) -> Result<MySqlPool, String> {
    self.pool("").await
  }

  /// 从连接池取出一个独占连接（用于需要会话级状态的批量写入，如 FOREIGN_KEY_CHECKS）。
  pub async fn acquire(&self, database: &str) -> Result<sqlx::pool::PoolConnection<MySql>, String> {
    let pool = self.pool(database).await?;
    pool.acquire().await.map_err(|e| e.to_string())
  }

  pub(super) fn invalidate_schema_cache(&self) { self.schemas.lock().clear(); }

  pub async fn close(&self) {
    let pools: Vec<_> = self.pools.lock().drain().map(|(_, p)| p).collect();
    for pool in pools {
      pool.close().await;
    }
  }

  pub async fn test(&self) -> Result<String, String> {
    // The connection dialog probes the server account, independently of the
    // optional default database and any per-database credentials.
    Self::test_pool(self.server_pool().await?).await
  }

  pub async fn test_database(&self, database: &str) -> Result<String, String> {
    if database.is_empty() { return Err("Database is required".into()); }
    Self::test_pool(self.pool(database).await?).await
  }

  async fn test_pool(pool: MySqlPool) -> Result<String, String> {
    let row: (String,) = sqlx::query_as("SELECT VERSION()")
      .fetch_one(&pool)
      .await
      .map_err(|e| e.to_string())?;
    Ok(format!("OK · MySQL {}", row.0))
  }

  pub async fn list_databases(&self) -> Result<Vec<String>, String> {
    let mut configured = super::connection_options::configured_databases(&self.connection);
    if super::connection_options::show_all_databases(&self.connection) {
      for database in self.discover_databases().await? {
        if !configured.contains(&database) { configured.push(database); }
      }
    }
    Ok(configured)
  }

  pub async fn discover_databases(&self) -> Result<Vec<String>, String> {
    let pool = self.server_pool().await?;
    let rows = sqlx::query("SHOW DATABASES")
      .fetch_all(&pool)
      .await
      .map_err(|e| e.to_string())?;
    let system: HashSet<&str> = SYSTEM_DATABASES.iter().copied().collect();
    let names = rows
      .iter()
      .map(|row| read_mysql_text(row, 0, "SHOW DATABASES name"))
      .collect::<Result<Vec<_>, _>>()?;
    Ok(
      names
        .into_iter()
        .filter(|name| !system.contains(name.as_str()))
        .collect(),
    )
  }

  pub async fn get_database_info(&self, database: &str) -> Result<DatabaseInfo, String> {
    assert_ident(database, "database")?;
    // Metadata must use the selected database's account, just like table reads.
    let pool = self.pool(database).await?;
    let meta = sqlx::query(
      "SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
       FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1",
    )
    .bind(database)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Database \"{database}\" not found"))?;

    let stats = sqlx::query(
      "SELECT CAST(COUNT(*) AS SIGNED) AS TABLE_COUNT,
              CAST(COALESCE(SUM(TABLE_ROWS), 0) AS SIGNED) AS ROW_ESTIMATE,
              CAST(COALESCE(SUM(DATA_LENGTH), 0) AS SIGNED) AS DATA_LENGTH,
              CAST(COALESCE(SUM(INDEX_LENGTH), 0) AS SIGNED) AS INDEX_LENGTH,
              CAST(COALESCE(SUM(DATA_FREE), 0) AS SIGNED) AS DATA_FREE
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
    )
    .bind(database)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let data_length: i64 = stats.try_get("DATA_LENGTH").unwrap_or(0);
    let index_length: i64 = stats.try_get("INDEX_LENGTH").unwrap_or(0);
    Ok(DatabaseInfo {
      name: database.to_string(),
      table_count: stats.try_get("TABLE_COUNT").unwrap_or(0),
      row_estimate: Some(stats.try_get("ROW_ESTIMATE").unwrap_or(0)),
      data_length: Some(data_length),
      index_length: Some(index_length),
      total_size: Some(data_length + index_length),
      data_free: Some(stats.try_get("DATA_FREE").unwrap_or(0)),
      charset: meta.try_get("DEFAULT_CHARACTER_SET_NAME").ok(),
      collation: meta.try_get("DEFAULT_COLLATION_NAME").ok(),
      owner: None,
      comment: None,
    })
  }

  pub async fn list_tables(&self, database: &str) -> Result<Vec<String>, String> {
    let pool = self.pool(database).await?;
    let rows = sqlx::query(
      "SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME",
    )
    .bind(database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    rows
      .iter()
      .map(|row| read_mysql_text(row, 0, "TABLE_NAME"))
      .collect()
  }

  pub async fn list_foreign_key_edges(
    &self,
    database: &str,
  ) -> Result<Vec<(String, String)>, String> {
    let pool = self.pool(database).await?;
    let rows = sqlx::query(
      "SELECT DISTINCT TABLE_NAME AS from_table, REFERENCED_TABLE_NAME AS to_table
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ?
         AND REFERENCED_TABLE_SCHEMA = ?
         AND REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY TABLE_NAME, REFERENCED_TABLE_NAME",
    )
    .bind(database)
    .bind(database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    rows
      .iter()
      .map(|row| {
        Ok((
          read_mysql_text(row, 0, "foreign key TABLE_NAME")?,
          read_mysql_text(row, 1, "foreign key REFERENCED_TABLE_NAME")?,
        ))
      })
      .collect()
  }

  pub async fn get_table_schema(&self, database: &str, table: &str) -> Result<TableSchema, String> {
    assert_ident(table, "table")?;
    let pool = self.pool(database).await?;
    let col_rows = sqlx::query(
      "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
              COLUMN_KEY, EXTRA, COLUMN_COMMENT
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION",
    )
    .bind(database)
    .bind(table)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let columns: Vec<ColumnInfo> = col_rows
      .into_iter()
      .map(|r| {
        let key: String = r.try_get("COLUMN_KEY").unwrap_or_default();
        let extra: String = r.try_get("EXTRA").unwrap_or_default();
        ColumnInfo {
          is_generated: extra.to_uppercase().contains("GENERATED"),
          name: r.try_get("COLUMN_NAME").unwrap_or_default(),
          col_type: r.try_get("COLUMN_TYPE").unwrap_or_default(),
          nullable: r
            .try_get::<String, _>("IS_NULLABLE")
            .map(|v| v == "YES")
            .unwrap_or(false),
          default_value: r.try_get("COLUMN_DEFAULT").ok(),
          is_primary_key: key == "PRI",
          is_auto_increment: extra.to_lowercase().contains("auto_increment"),
          comment: r.try_get("COLUMN_COMMENT").unwrap_or_default(),
          column_key: key,
        }
      })
      .collect();

    let idx_rows = sqlx::query(
      "SELECT INDEX_NAME, NON_UNIQUE, INDEX_TYPE, COLUMN_NAME, SEQ_IN_INDEX
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX",
    )
    .bind(database)
    .bind(table)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut index_map: HashMap<String, IndexInfo> = HashMap::new();
    for r in idx_rows {
      let name: String = r.try_get("INDEX_NAME").unwrap_or_default();
      let col: String = r.try_get("COLUMN_NAME").unwrap_or_default();
      let entry = index_map.entry(name.clone()).or_insert_with(|| IndexInfo {
        name: name.clone(),
        columns: vec![],
        unique: {
          let nu: i64 = r.try_get("NON_UNIQUE").unwrap_or(1);
          nu == 0
        },
        index_type: r.try_get("INDEX_TYPE").unwrap_or_else(|_| "BTREE".into()),
      });
      entry.columns.push(col);
    }
    let indexes: Vec<IndexInfo> = index_map.into_values().collect();
    let primary_key = indexes
      .iter()
      .find(|i| i.name == "PRIMARY")
      .map(|i| i.columns.clone())
      .unwrap_or_default();

    let create_sql = {
      let sql = format!("SHOW CREATE TABLE {}", quote_mysql_table(database, table));
      let row = sqlx::query(&sql)
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
      read_mysql_text(&row, 1, "SHOW CREATE TABLE result")?
    };

    let stats = sqlx::query(
      "SELECT CAST(TABLE_ROWS AS SIGNED) AS TABLE_ROWS,
              ENGINE, TABLE_COLLATION, TABLE_COMMENT,
              CAST(DATA_LENGTH AS SIGNED) AS DATA_LENGTH,
              CAST(INDEX_LENGTH AS SIGNED) AS INDEX_LENGTH,
              CAST(DATA_FREE AS SIGNED) AS DATA_FREE,
              CAST(AVG_ROW_LENGTH AS SIGNED) AS AVG_ROW_LENGTH,
              CAST(AUTO_INCREMENT AS SIGNED) AS AUTO_INCREMENT,
              DATE_FORMAT(CREATE_TIME, '%Y-%m-%d %H:%i:%s') AS CREATE_TIME,
              DATE_FORMAT(UPDATE_TIME, '%Y-%m-%d %H:%i:%s') AS UPDATE_TIME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    )
    .bind(database)
    .bind(table)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(TableSchema {
      name: table.to_string(),
      columns,
      indexes,
      primary_key,
      create_sql,
      row_estimate: stats
        .as_ref()
        .and_then(|row| row.try_get("TABLE_ROWS").ok()),
      engine: stats.as_ref().and_then(|s| s.try_get("ENGINE").ok()),
      charset: stats
        .as_ref()
        .and_then(|s| s.try_get("TABLE_COLLATION").ok()),
      table_comment: stats.as_ref().and_then(|s| s.try_get("TABLE_COMMENT").ok()),
      data_length: stats.as_ref().and_then(|s| s.try_get("DATA_LENGTH").ok()),
      index_length: stats.as_ref().and_then(|s| s.try_get("INDEX_LENGTH").ok()),
      data_free: stats.as_ref().and_then(|s| s.try_get("DATA_FREE").ok()),
      avg_row_length: stats
        .as_ref()
        .and_then(|s| s.try_get("AVG_ROW_LENGTH").ok()),
      auto_increment: stats
        .as_ref()
        .and_then(|s| s.try_get("AUTO_INCREMENT").ok()),
      created_at: stats
        .as_ref()
        .and_then(|s| s.try_get::<String, _>("CREATE_TIME").ok()),
      updated_at: stats
        .as_ref()
        .and_then(|s| s.try_get::<String, _>("UPDATE_TIME").ok()),
    })
  }

  async fn query_schema(&self, database: &str, table: &str) -> Result<TableSchema, String> {
    let key = (database.to_string(), table.to_string());
    if let Some((at, schema)) = self.schemas.lock().get(&key) {
      if at.elapsed() < std::time::Duration::from_secs(15) {
        return Ok(schema.clone());
      }
    }
    let schema = self.get_table_schema(database, table).await?;
    let mut cache = self.schemas.lock();
    super::connection_options::cache_schema(&mut cache, key, schema.clone());
    Ok(schema)
  }

  pub async fn query_rows(&self, req: &QueryRowsRequest) -> Result<QueryRowsResult, String> {
    assert_ident(&req.table, "table")?;
    assert_safe_where(req.where_fragment())?;
    let schema = self.query_schema(&req.database, &req.table).await?;
    let table = quote_mysql_table(&req.database, &req.table);
    let mut where_clause = if let Some(keys) = &req.key_rows {
      format!(
        "WHERE {}",
        crate::drivers::dialect::key_rows_filter(
          keys,
          &schema.primary_key,
          crate::drivers::dialect::SqlDialect::Mysql
        )?
      )
    } else {
      req
        .where_fragment()
        .map(|w| format!("WHERE {w}"))
        .unwrap_or_default()
    };
    let dialect = crate::drivers::dialect::SqlDialect::Mysql;
    let projection = crate::drivers::dialect::browse_projection(&schema, req.columns.as_deref(), dialect)?;
    let cursor = crate::drivers::dialect::browse_cursor_filter(&schema, req, dialect)?;
    if let Some(cursor) = &cursor {
      where_clause = if where_clause.is_empty() { format!("WHERE {cursor}") }
        else { format!("WHERE ({}) AND ({cursor})", where_clause.trim_start_matches("WHERE ")) };
    }
    let order_clause = build_order_clause(&schema, req.order_by.as_ref())?;
    let limit = clamp_page_size(req.page_size);
    let offset = if req.key_rows.is_some() {
      0
    } else {
      u64::from(req.page.saturating_sub(1)) * u64::from(limit)
    };
    let fetch_limit = if req.key_rows.is_some() { limit } else { limit + 1 };
    let sql = crate::drivers::dialect::browse_select_sql(&table, &projection, &where_clause, &order_clause, fetch_limit, offset, cursor.is_some());
    let mut connection = self.acquire_active(&req.database).await?;
    let rows = tokio::time::timeout(std::time::Duration::from_secs(60), sqlx::query(&sql).fetch_all(&mut *connection))
      .await.map_err(|_| "Query timed out after 60 seconds".to_string())?
      .map_err(|e| e.to_string())?;
    connection.complete();
    let mut mapped = rows
      .iter()
      .map(json_from_mysql_row)
      .collect::<Result<Vec<_>, _>>()?;
    if req.key_rows.is_some() {
      return Ok(QueryRowsResult {
        total: mapped.len() as i64,
        has_more: false,
        total_is_exact: true,
        next_cursor: None,
        rows: mapped,
        has_primary_key: !schema.primary_key.is_empty(),
        primary_key: schema.primary_key,
        columns: schema.columns,
      });
    }
    let has_more = mapped.len() > limit as usize;
    mapped.truncate(limit as usize);
    let next_cursor = crate::drivers::dialect::next_browse_cursor(&schema, req, &mapped, has_more);
    let observed_offset = if cursor.is_some() { 0 } else { offset };
    let total = if mapped.is_empty() { 0 } else { (observed_offset + mapped.len() as u64 + u64::from(has_more)).min(i64::MAX as u64) as i64 };
    Ok(QueryRowsResult {
      rows: mapped,
      total,
      has_more,
      total_is_exact: cursor.is_none() && !has_more && (offset == 0 || !rows.is_empty()),
      next_cursor,
      has_primary_key: !schema.primary_key.is_empty(),
      primary_key: schema.primary_key.clone(),
      columns: schema.columns,
    })
  }

  pub async fn insert_row(&self, req: &InsertRowRequest) -> Result<(), String> {
    self.schemas.lock().clear();
    if req.values.is_empty() {
      return Err("No values to insert".into());
    }
    let dialect = crate::drivers::dialect::SqlDialect::Mysql;
    let pool = self.pool(&req.database).await?;
    let mut columns: Vec<_> = req.values.keys().collect();
    columns.sort();
    let names = columns
      .iter()
      .map(|c| dialect.quote_ident(c))
      .collect::<Vec<_>>()
      .join(", ");
    let values = columns
      .iter()
      .map(|c| dialect.literal(req.values.get(*c)))
      .collect::<Vec<_>>()
      .join(", ");
    let sql = format!(
      "INSERT INTO {} ({names}) VALUES ({values})",
      quote_mysql_table(&req.database, &req.table)
    );
    sqlx::query(&sql)
      .execute(&pool)
      .await
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub async fn update_row(&self, req: &UpdateRowRequest) -> Result<(), String> {
    self.schemas.lock().clear();
    if req.changes.is_empty() {
      return Ok(());
    }
    let dialect = crate::drivers::dialect::SqlDialect::Mysql;
    let schema = self.get_table_schema(&req.database, &req.table).await?;
    let predicate = crate::drivers::dialect::key_rows_filter(
      std::slice::from_ref(&req.pk_values),
      &schema.primary_key,
      dialect,
    )?;
    let assignments = req
      .changes
      .iter()
      .map(|(name, value)| {
        format!(
          "{} = {}",
          dialect.quote_ident(name),
          dialect.literal(Some(value))
        )
      })
      .collect::<Vec<_>>()
      .join(", ");
    let pool = self.pool(&req.database).await?;
    sqlx::query(&format!(
      "UPDATE {} SET {assignments} WHERE {predicate}",
      quote_mysql_table(&req.database, &req.table)
    ))
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub async fn delete_rows(&self, req: &DeleteRowsRequest) -> Result<(), String> {
    self.schemas.lock().clear();
    if req.pk_rows.is_empty() {
      return Ok(());
    }
    let dialect = crate::drivers::dialect::SqlDialect::Mysql;
    let schema = self.get_table_schema(&req.database, &req.table).await?;
    // Validate all requested keys before starting any deletion.
    for keys in req.pk_rows.chunks(1000) {
      crate::drivers::dialect::key_rows_filter(keys, &schema.primary_key, dialect)?;
    }
    let pool = self.pool(&req.database).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for keys in req.pk_rows.chunks(1000) {
      let predicate = crate::drivers::dialect::key_rows_filter(keys, &schema.primary_key, dialect)?;
      sqlx::query(&format!(
        "DELETE FROM {} WHERE {predicate}",
        quote_mysql_table(&req.database, &req.table)
      ))
      .execute(&mut *tx)
      .await
      .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
  }

  pub async fn execute_sql(&self, sql: &str, database: Option<&str>) -> Result<Value, String> {
    super::maintenance::assert_safe_mysql_cancellation(sql)?;
    use futures::StreamExt;
    self.schemas.lock().clear();
    let database = database.unwrap_or("").to_string();
    let mut connection = self.acquire_active(&database).await?;
    let operation = async {
    let mut results = (&mut *connection).fetch_many(sql);
    let mut rows = Vec::new();
    let mut statements = Vec::new();
    let mut row_count = 0usize;
    let mut bytes = 0usize;
    let mut truncated = false;
    while let Some(result) = results.next().await {
      match result.map_err(|e| e.to_string())? {
        sqlx::Either::Left(done) => {
          if row_count > 0 {
            statements.push(serde_json::json!({"rows": rows, "truncated": truncated}));
          } else {
            statements.push(serde_json::json!({"affectedRows": done.rows_affected()}));
          }
          rows = Vec::new();
          row_count = 0;
        }
        sqlx::Either::Right(row) => {
          row_count += 1;
          if !truncated {
            let row = json_from_mysql_row(&row)?;
            bytes += serde_json::to_vec(&row).map_err(|e| e.to_string())?.len();
            if row_count <= 10000 && bytes <= 16 * 1024 * 1024 {
              rows.push(row);
            } else {
              truncated = true;
            }
          }
        }
      }
    }
    if statements.len() == 1 {
      Ok(statements.remove(0))
    } else {
      Ok(serde_json::json!({"results": statements}))
    }
    };
    let result = tokio::time::timeout(std::time::Duration::from_secs(60), operation).await
      .map_err(|_| "SQL execution timed out after 60 seconds; the connection was closed".to_string())?;
    if result.is_ok() { connection.complete(); }
    result
  }

  pub async fn explain_sql(
    &self,
    sql: &str,
    database: Option<&str>,
  ) -> Result<ExplainSQLResult, String> {
    let db = database.unwrap_or("");
    let mut connection = self.acquire_active(db).await?;
    let explain_sql = format!("EXPLAIN {sql}");
    let rows = tokio::time::timeout(std::time::Duration::from_secs(60), sqlx::query(&explain_sql).fetch_all(&mut *connection))
      .await.map_err(|_| "Explain timed out after 60 seconds".to_string())?.map_err(|e| e.to_string())?;
    connection.complete();
    let mapped = rows
      .iter()
      .map(json_from_mysql_row)
      .collect::<Result<Vec<_>, _>>()?;
    let columns = mapped
      .first()
      .map(|r| r.keys().cloned().collect())
      .unwrap_or_default();
    Ok(ExplainSQLResult {
      engine: "mysql".into(),
      statement: sql.to_string(),
      summary: vec![ExplainPlanMetric {
        label: "rows".into(),
        value: Value::Number(mapped.len().into()),
      }],
      plan: None,
      columns,
      rows: mapped,
      raw: None,
    })
  }

  pub async fn rename_table(&self, req: &RenameTableRequest) -> Result<String, String> {
    self.schemas.lock().clear();
    assert_ident(&req.new_table, "newTable")?;
    let pool = self.pool(&req.database).await?;
    let sql = format!(
      "RENAME TABLE {} TO {}",
      quote_mysql_table(&req.database, &req.table),
      quote_mysql_table(&req.database, &req.new_table)
    );
    sqlx::query(&sql)
      .execute(&pool)
      .await
      .map_err(|e| e.to_string())?;
    Ok(req.new_table.clone())
  }

  pub async fn copy_table(&self, req: &CopyTableRequest) -> Result<String, String> {
    self.schemas.lock().clear();
    assert_ident(&req.target_table, "targetTable")?;
    let pool = self.pool(&req.database).await?;
    let src = quote_mysql_table(&req.database, &req.table);
    let dst = quote_mysql_table(&req.database, &req.target_table);
    sqlx::query(&format!("CREATE TABLE {dst} LIKE {src}"))
      .execute(&pool)
      .await
      .map_err(|e| e.to_string())?;
    if let Err(error) = sqlx::query(&format!("INSERT INTO {dst} SELECT * FROM {src}")).execute(&pool).await {
      // CREATE above succeeded, so only this operation's newly created target
      // is removed. Never drop a pre-existing target after a CREATE failure.
      return match sqlx::query(&format!("DROP TABLE {dst}")).execute(&pool).await {
        Ok(_) => Err(format!("Copy failed; the newly created target was removed: {error}")),
        Err(cleanup) => Err(format!("Copy failed: {error}; could not remove the newly created target: {cleanup}")),
      };
    }
    Ok(req.target_table.clone())
  }

  pub async fn drop_database(&self, req: &DropDatabaseRequest) -> Result<(), String> {
    self.schemas.lock().clear();
    if SYSTEM_DATABASES.contains(&req.database.as_str()) {
      return Err("Refusing to drop system database".into());
    }
    let pool = self.server_pool().await?;
    let sql = format!("DROP DATABASE {}", quote_mysql_ident(&req.database));
    sqlx::query(&sql)
      .execute(&pool)
      .await
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub async fn drop_table(&self, req: &DropTableRequest) -> Result<(), String> {
    self.schemas.lock().clear();
    let pool = self.pool(&req.database).await?;
    let sql = format!(
      "DROP TABLE {}",
      quote_mysql_table(&req.database, &req.table)
    );
    sqlx::query(&sql)
      .execute(&pool)
      .await
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub async fn truncate_table(&self, req: &TruncateTableRequest) -> Result<(), String> {
    self.schemas.lock().clear();
    let pool = self.pool(&req.database).await?;
    let table = quote_mysql_table(&req.database, &req.table);
    let sql = if req.reset_identity.unwrap_or(true) {
      format!("TRUNCATE TABLE {table}")
    } else {
      format!("DELETE FROM {table}")
    };
    sqlx::query(&sql)
      .execute(&pool)
      .await
      .map_err(|e| e.to_string())?;
    Ok(())
  }
}

fn build_order_clause(schema: &TableSchema, order_by: Option<&crate::types::OrderBy>) -> Result<String, String> {
  let mut parts = Vec::new();
  let mut seen = HashSet::new();
  if let Some(ob) = order_by {
    if !matches!(ob.dir.as_str(), "ASC" | "DESC") { return Err("Invalid sort direction: use ASC or DESC".into()); }
    if !schema.columns.iter().any(|column| column.name == ob.column) { return Err("Unknown sort column".into()); }
    parts.push(format!("{} {}", quote_mysql_ident(&ob.column), ob.dir));
    seen.insert(ob.column.clone());
  }
  for name in &schema.primary_key {
    if seen.insert(name.clone()) { parts.push(format!("{} ASC", quote_mysql_ident(name))); }
  }
  Ok(if parts.is_empty() { String::new() } else { format!("ORDER BY {}", parts.join(", ")) })
}

#[allow(dead_code)]
fn _row_type(_: &MySqlRow) {}

fn read_mysql_text(row: &MySqlRow, index: usize, field: &str) -> Result<String, String> {
  // MySQL can mark UTF-8 metadata as BINARY (notably filesystem names when
  // lower_case_table_names=0). sqlx then rejects String even though the bytes
  // are text. Decode them strictly, and propagate errors instead of silently
  // dropping databases, tables, or foreign-key dependencies from discovery.
  match row.try_get::<String, _>(index) {
    Ok(value) => Ok(value),
    Err(string_error) => {
      let bytes = row.try_get::<Vec<u8>, _>(index).map_err(|bytes_error| {
        format!("read {field}: {string_error}; binary text fallback failed: {bytes_error}")
      })?;
      String::from_utf8(bytes).map_err(|error| format!("decode {field} as UTF-8: {error}"))
    }
  }
}

#[cfg(test)]
mod security_tests {
  use super::*;
  fn schema(primary_key: Vec<&str>) -> TableSchema {
    serde_json::from_value(serde_json::json!({"name":"items", "columns":[{"name":"id","type":"int","nullable":false,"isPrimaryKey":true,"isAutoIncrement":false,"comment":"","columnKey":"PRI"},{"name":"payload","type":"text","nullable":true,"isPrimaryKey":false,"isAutoIncrement":false,"comment":"","columnKey":""}], "indexes":[], "primaryKey":primary_key, "createSQL":""})).unwrap()
  }
  #[test]
  fn ordering_rejects_unstructured_direction_and_avoids_keyless_filesort() {
    let keyless = schema(vec![]);
    assert_eq!(build_order_clause(&keyless, None).unwrap(), "");
    for direction in ["ASC; DROP TABLE items", "DESC --", "ASC NULLS FIRST", ""] {
      assert!(build_order_clause(&keyless, Some(&crate::types::OrderBy { column:"id".into(), dir:direction.into() })).is_err());
    }
    assert!(build_order_clause(&keyless, Some(&crate::types::OrderBy { column:"missing".into(), dir:"ASC".into() })).is_err());
    assert!(build_order_clause(&schema(vec!["id"]), None).unwrap().contains("ASC"));
  }
  #[tokio::test]
  async fn remote_connect_options_require_identity_validation() {
    let config: ConnectionConfig = serde_json::from_value(serde_json::json!({"id":"tls", "name":"TLS", "host":"db.example.com", "port":5432, "username":"user", "createdAt":0,"updatedAt":0})).unwrap();
    let driver = MysqlDriver::open(config.clone(), None).await.unwrap();
    assert!(matches!(driver.connect_options("db").unwrap().get_ssl_mode(), MySqlSslMode::VerifyIdentity));
    let driver = MysqlDriver::open(config, Some(1234)).await.unwrap();
    assert!(matches!(driver.connect_options("db").unwrap().get_ssl_mode(), MySqlSslMode::Disabled));
  }
}
