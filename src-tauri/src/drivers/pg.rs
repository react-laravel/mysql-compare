use std::collections::{HashMap, HashSet};

use parking_lot::Mutex;
use serde_json::Value;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::{Executor, Postgres, Row};

use crate::drivers::dialect::{
  assert_pg_table, pg_table_parts, pg_table_key, assert_safe_where, clamp_page_size, quote_pg_ident, quote_pg_table,
};
use crate::drivers::util::{json_from_pg_row, urlencoding};
use crate::types::{
  ColumnInfo, ConnectionConfig, CopyTableRequest, DatabaseInfo, DeleteRowsRequest,
  DropDatabaseRequest, DropTableRequest, ExplainPlanMetric, ExplainSQLResult, IndexInfo,
  InsertRowRequest, QueryRowsRequest, QueryRowsResult, RenameTableRequest, TableSchema,
  TruncateTableRequest, UpdateRowRequest,
};

const DEFAULT_SCHEMA: &str = "public";

pub struct PgDriver {
  pub(super) connection: ConnectionConfig,
  local_port: Option<u16>,
  pools: Mutex<HashMap<String, PgPool>>,
  schemas: Mutex<HashMap<(String, String), (std::time::Instant, TableSchema)>>,
}

impl PgDriver {
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

  fn url_for_db(&self, database: &str) -> String {
    let (host, port) = self.host_port();
    let (username, password) = super::connection_options::credentials(&self.connection, database);
    let user = urlencoding(username);
    let pass = urlencoding(password);
    format!("postgres://{user}:{pass}@{host}:{port}/{}", urlencoding(database))
  }

  async fn pool(&self, database: &str) -> Result<PgPool, String> {
    {
      let guard = self.pools.lock();
      if let Some(pool) = guard.get(database) {
        return Ok(pool.clone());
      }
    }
    let url = self.url_for_db(database);
    let pool = PgPoolOptions::new()
      .max_connections(5)
      .connect(&url)
      .await
      .map_err(|e| format!("PostgreSQL connect failed: {e}"))?;
    self.pools.lock().insert(database.to_string(), pool.clone());
    Ok(pool)
  }

  /// 从连接池取出一个独占连接（用于需要单一会话的批量写入）。
  pub async fn acquire(
    &self,
    database: &str,
  ) -> Result<sqlx::pool::PoolConnection<Postgres>, String> {
    let pool = self.pool(database).await?;
    pool.acquire().await.map_err(|e| e.to_string())
  }

  async fn maintenance_pool(&self) -> Result<PgPool, String> {
    let database = self.connection.database.as_deref().filter(|name| !name.trim().is_empty())
      .unwrap_or(if self.connection.username.trim().is_empty() { "postgres" } else { &self.connection.username });
    self.pool(database).await
  }

  pub async fn close(&self) {
    let pools: Vec<_> = self.pools.lock().drain().map(|(_, p)| p).collect();
    for pool in pools {
      pool.close().await;
    }
  }

  pub async fn test(&self) -> Result<String, String> {
    let pool = self.maintenance_pool().await?;
    let row: (String,) = sqlx::query_as("SELECT version()")
      .fetch_one(&pool)
      .await
      .map_err(|e| e.to_string())?;
    Ok(format!(
      "OK · {}",
      row.0.split(',').next().unwrap_or("PostgreSQL")
    ))
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
    let pool = self.maintenance_pool().await?;
    let rows = sqlx::query(
      "SELECT datname FROM pg_database
       WHERE NOT datistemplate AND datallowconn
       ORDER BY datname",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(
      rows
        .into_iter()
        .filter_map(|r| r.try_get::<String, _>(0).ok())
        .collect(),
    )
  }

  pub async fn get_database_info(&self, database: &str) -> Result<DatabaseInfo, String> {
    let pool = self.pool(database).await?;
    let count: (i64,) = sqlx::query_as(
      "SELECT COUNT(*) FROM information_schema.tables
       WHERE left(table_schema, 3) <> 'pg_' AND table_schema <> 'information_schema' AND table_type = 'BASE TABLE' AND has_schema_privilege(table_schema, 'USAGE')",
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(DatabaseInfo {
      name: database.to_string(),
      table_count: count.0,
      row_estimate: None,
      data_length: None,
      index_length: None,
      total_size: None,
      data_free: None,
      charset: None,
      collation: None,
      owner: None,
      comment: None,
    })
  }

  pub async fn list_schemas(&self, database: &str) -> Result<Vec<String>, String> {
    let pool = self.pool(database).await?;
    sqlx::query_scalar("SELECT nspname FROM pg_namespace WHERE left(nspname, 3) <> 'pg_' AND nspname <> 'information_schema' AND has_schema_privilege(oid, 'USAGE') ORDER BY (nspname = 'public') DESC, nspname")
      .fetch_all(&pool).await.map_err(|e| e.to_string())
  }

  pub async fn list_tables(&self, database: &str) -> Result<Vec<String>, String> {
    self.list_tables_for_schema(database, None).await
  }

  pub async fn list_tables_in_schema(&self, database: &str, schema: &str) -> Result<Vec<String>, String> {
    self.list_tables_for_schema(database, Some(schema)).await
  }

  async fn list_tables_for_schema(&self, database: &str, schema: Option<&str>) -> Result<Vec<String>, String> {
    let pool = self.pool(database).await?;
    if let Some(schema) = schema {
      let allowed: bool = sqlx::query_scalar("SELECT has_schema_privilege($1, 'USAGE')").bind(schema).fetch_one(&pool).await.map_err(|e| e.to_string())?;
      if !allowed { return Err("permission denied for schema".into()); }
    }
    let rows = sqlx::query("SELECT table_schema, table_name FROM information_schema.tables WHERE ($1::text IS NULL OR table_schema = $1) AND left(table_schema, 3) <> 'pg_' AND table_schema <> 'information_schema' AND table_type = 'BASE TABLE' AND has_schema_privilege(table_schema, 'USAGE') ORDER BY table_schema, table_name")
      .bind(schema).fetch_all(&pool).await.map_err(|e| e.to_string())?;
    rows.into_iter().map(|row| Ok(pg_table_key(&row.try_get::<String,_>("table_schema").map_err(|e| e.to_string())?, &row.try_get::<String,_>("table_name").map_err(|e| e.to_string())?))).collect()
  }

  pub async fn list_foreign_key_edges(
    &self,
    database: &str,
  ) -> Result<Vec<(String, String)>, String> {
    let pool = self.pool(database).await?;
    let rows = sqlx::query("SELECT sn.nspname AS from_schema, src.relname AS from_table, tn.nspname AS to_schema, dst.relname AS to_table FROM pg_constraint c JOIN pg_class src ON src.oid = c.conrelid JOIN pg_namespace sn ON sn.oid = src.relnamespace JOIN pg_class dst ON dst.oid = c.confrelid JOIN pg_namespace tn ON tn.oid = dst.relnamespace WHERE c.contype = 'f'")
      .fetch_all(&pool).await.map_err(|e| e.to_string())?;
    rows.into_iter().map(|row| {
      Ok((pg_table_key(&row.try_get::<String,_>("from_schema").map_err(|e| e.to_string())?, &row.try_get::<String,_>("from_table").map_err(|e| e.to_string())?), pg_table_key(&row.try_get::<String,_>("to_schema").map_err(|e| e.to_string())?, &row.try_get::<String,_>("to_table").map_err(|e| e.to_string())?)))
    }).collect()
  }

  pub async fn get_table_schema(&self, database: &str, table: &str) -> Result<TableSchema, String> {
    assert_pg_table(table)?;
    let (table_schema, table_name) = pg_table_parts(table);
    let pool = self.pool(database).await?;
    let col_rows = sqlx::query(
      "SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type,
              CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
              pg_get_expr(d.adbin, d.adrelid) AS column_default, t.typname AS udt_name,
              a.attidentity::text AS identity_kind, a.attgenerated::text AS generated_kind,
              col_description(c.oid, a.attnum) AS comment
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_type t ON t.oid = a.atttypid
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum",
    )
    .bind(&table_schema)
    .bind(&table_name)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let pk_rows = sqlx::query(
      "SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema = $1 AND tc.table_name = $2
       ORDER BY kcu.ordinal_position",
    )
    .bind(&table_schema)
    .bind(&table_name)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let primary_key: Vec<String> = pk_rows
      .into_iter()
      .filter_map(|r| r.try_get::<String, _>(0).ok())
      .collect();
    let pk_set: HashSet<_> = primary_key.iter().cloned().collect();

    if col_rows.is_empty() {
      return Err(format!("Table {} has no readable columns", crate::drivers::dialect::pg_table_display_name(table)));
    }
    let mut definitions = Vec::new();
    for row in &col_rows {
      let name: String = row.try_get("column_name").map_err(|e| e.to_string())?;
      let mut col_type: String = row.try_get("data_type").map_err(|e| e.to_string())?;
      let default: Option<String> = row.try_get("column_default").map_err(|e| e.to_string())?;
      let identity: String = row.try_get("identity_kind").map_err(|e| e.to_string())?;
      let generated: String = row.try_get("generated_kind").map_err(|e| e.to_string())?;
      let mut suffix = String::new();
      if !generated.is_empty() {
        suffix = format!(
          " GENERATED ALWAYS AS ({}) STORED",
          default.as_deref().ok_or("Missing generated expression")?
        );
      } else if !identity.is_empty() {
        suffix = format!(
          " GENERATED {} AS IDENTITY",
          if identity == "a" {
            "ALWAYS"
          } else {
            "BY DEFAULT"
          }
        );
      } else if let Some(default) = &default {
        if default.starts_with("nextval(")
          && matches!(col_type.as_str(), "smallint" | "integer" | "bigint")
        {
          col_type = match col_type.as_str() {
            "smallint" => "smallserial",
            "integer" => "serial",
            _ => "bigserial",
          }
          .into();
        } else {
          suffix = format!(" DEFAULT {default}");
        }
      }
      if row
        .try_get::<String, _>("is_nullable")
        .map_err(|e| e.to_string())?
        == "NO"
      {
        suffix.push_str(" NOT NULL");
      }
      definitions.push(format!("  {} {col_type}{suffix}", quote_pg_ident(&name)));
    }
    let constraints = sqlx::query("SELECT con.conname, pg_get_constraintdef(con.oid, true) AS definition
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2 AND con.contype IN ('p','u','f','c','x') ORDER BY con.conname")
      .bind(&table_schema).bind(&table_name).fetch_all(&pool).await.map_err(|e| e.to_string())?;
    for row in constraints {
      let name: String = row.try_get("conname").map_err(|e| e.to_string())?;
      let definition: String = row.try_get("definition").map_err(|e| e.to_string())?;
      definitions.push(format!(
        "  CONSTRAINT {} {definition}",
        quote_pg_ident(&name)
      ));
    }
    let index_rows = sqlx::query("SELECT ci.relname AS name, i.indisunique AS unique_index, am.amname AS index_type,
       ARRAY(SELECT pg_get_indexdef(i.indexrelid, k, true) FROM generate_series(1, i.indnkeyatts) k ORDER BY k) AS columns,
       pg_get_indexdef(i.indexrelid) AS definition,
       EXISTS(SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid AND con.contype IN ('p','u','x')) AS owned
       FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_class ci ON ci.oid = i.indexrelid JOIN pg_am am ON am.oid = ci.relam
       WHERE n.nspname = $1 AND c.relname = $2 ORDER BY ci.relname")
      .bind(&table_schema).bind(&table_name).fetch_all(&pool).await.map_err(|e| e.to_string())?;
    let mut indexes = Vec::new();
    let mut index_sql = Vec::new();
    for row in index_rows {
      indexes.push(IndexInfo {
        name: row.try_get("name").map_err(|e| e.to_string())?,
        columns: row.try_get("columns").map_err(|e| e.to_string())?,
        unique: row.try_get("unique_index").map_err(|e| e.to_string())?,
        index_type: row.try_get("index_type").map_err(|e| e.to_string())?,
      });
      if !row.try_get::<bool, _>("owned").map_err(|e| e.to_string())? {
        index_sql.push(
          row
            .try_get::<String, _>("definition")
            .map_err(|e| e.to_string())?,
        );
      }
    }
    let mut create_sql = format!(
      "CREATE TABLE {} (\n{}\n)",
      quote_pg_table(DEFAULT_SCHEMA, table),
      definitions.join(",\n")
    );
    for index in index_sql {
      create_sql.push_str(&format!(";\n{index}"));
    }

    let columns: Vec<ColumnInfo> = col_rows
      .into_iter()
      .map(|r| {
        let name: String = r.try_get("column_name").unwrap_or_default();
        let default_value: Option<String> = r.try_get("column_default").ok();
        let is_ai = default_value
          .as_deref()
          .map(|d| d.contains("nextval"))
          .unwrap_or(false)
          || r
            .try_get::<String, _>("identity_kind")
            .map(|v| !v.is_empty())
            .unwrap_or(false);
        ColumnInfo {
          is_generated: r
            .try_get::<String, _>("generated_kind")
            .map(|value| !value.is_empty())
            .unwrap_or(false),
          name: name.clone(),
          col_type: r.try_get::<String, _>("data_type").unwrap_or_default(),
          nullable: r
            .try_get::<String, _>("is_nullable")
            .map(|v| v == "YES")
            .unwrap_or(false),
          default_value,
          is_primary_key: pk_set.contains(&name),
          is_auto_increment: is_ai,
          comment: r.try_get::<String, _>("comment").unwrap_or_default(),
          column_key: if pk_set.contains(&name) {
            "PRI".into()
          } else {
            String::new()
          },
        }
      })
      .collect();

    Ok(TableSchema {
      name: table.to_string(),
      columns,
      indexes,
      primary_key,
      create_sql,
      row_estimate: None,
      engine: Some("postgres".into()),
      charset: None,
      table_comment: None,
      data_length: None,
      index_length: None,
      data_free: None,
      avg_row_length: None,
      auto_increment: None,
      created_at: None,
      updated_at: None,
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
    if cache.len() >= 128 {
      cache.clear();
    }
    cache.insert(key, (std::time::Instant::now(), schema.clone()));
    Ok(schema)
  }

  pub async fn query_rows(&self, req: &QueryRowsRequest) -> Result<QueryRowsResult, String> {
    assert_pg_table(&req.table)?;
    assert_safe_where(req.where_fragment())?;
    let schema = self.query_schema(&req.database, &req.table).await?;
    let pool = self.pool(&req.database).await?;
    let table = quote_pg_table(DEFAULT_SCHEMA, &req.table);
    let where_clause = if let Some(keys) = &req.key_rows {
      format!(
        "WHERE {}",
        crate::drivers::dialect::key_rows_filter(
          keys,
          &schema.primary_key,
          crate::drivers::dialect::SqlDialect::Postgres
        )?
      )
    } else {
      req
        .where_fragment()
        .map(|w| format!("WHERE {w}"))
        .unwrap_or_default()
    };
    let order_clause = build_order(&schema, req.order_by.as_ref());
    let limit = clamp_page_size(req.page_size);
    let offset = if req.key_rows.is_some() {
      0
    } else {
      u64::from(req.page.saturating_sub(1)) * u64::from(limit)
    };
    let sql =
      format!("SELECT * FROM {table} {where_clause} {order_clause} LIMIT {limit} OFFSET {offset}");
    let rows = sqlx::query(&sql)
      .fetch_all(&pool)
      .await
      .map_err(|e| e.to_string())?;
    let mapped = rows
      .iter()
      .map(json_from_pg_row)
      .collect::<Result<Vec<_>, _>>()?;
    if req.key_rows.is_some() {
      return Ok(QueryRowsResult {
        total: mapped.len() as i64,
        rows: mapped,
        has_primary_key: !schema.primary_key.is_empty(),
        primary_key: schema.primary_key,
        columns: schema.columns,
      });
    }
    let count_sql = format!("SELECT COUNT(*)::bigint AS c FROM {table} {where_clause}");
    let count_row = sqlx::query(&count_sql)
      .fetch_one(&pool)
      .await
      .map_err(|e| e.to_string())?;
    Ok(QueryRowsResult {
      rows: mapped,
      total: count_row.try_get("c").unwrap_or(0),
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
    let dialect = crate::drivers::dialect::SqlDialect::Postgres;
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
      quote_pg_table(DEFAULT_SCHEMA, &req.table)
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
    let dialect = crate::drivers::dialect::SqlDialect::Postgres;
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
      quote_pg_table(DEFAULT_SCHEMA, &req.table)
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
    let dialect = crate::drivers::dialect::SqlDialect::Postgres;
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
        quote_pg_table(DEFAULT_SCHEMA, &req.table)
      ))
      .execute(&mut *tx)
      .await
      .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
  }

  pub async fn execute_sql(&self, sql: &str, database: Option<&str>) -> Result<Value, String> {
    use futures::StreamExt;
    self.schemas.lock().clear();
    let database = database
      .map(str::to_string)
      .or_else(|| self.connection.database.clone())
      .unwrap_or_else(|| "postgres".into());
    let pool = self.pool(&database).await?;
    let mut results = pool.fetch_many(sql);
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
            let row = json_from_pg_row(&row)?;
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
  }

  pub async fn explain_sql(
    &self,
    sql: &str,
    database: Option<&str>,
  ) -> Result<ExplainSQLResult, String> {
    let db = database
      .map(str::to_string)
      .or_else(|| self.connection.database.clone())
      .unwrap_or_else(|| "postgres".into());
    let pool = self.pool(&db).await?;
    let explain_sql = format!("EXPLAIN (FORMAT JSON) {sql}");
    let row = sqlx::query(&explain_sql)
      .fetch_one(&pool)
      .await
      .map_err(|e| e.to_string())?;
    let plan_json: Value = row.try_get(0).unwrap_or(Value::Null);
    Ok(ExplainSQLResult {
      engine: "postgres".into(),
      statement: sql.to_string(),
      summary: vec![ExplainPlanMetric {
        label: "format".into(),
        value: Value::String("json".into()),
      }],
      plan: None,
      columns: vec!["QUERY PLAN".into()],
      rows: vec![HashMap::from([("QUERY PLAN".into(), plan_json.clone())])],
      raw: Some(plan_json),
    })
  }

  pub async fn rename_table(&self, req: &RenameTableRequest) -> Result<String, String> {
    self.schemas.lock().clear();
    let pool = self.pool(&req.database).await?;
    assert_pg_table(&req.table)?;
    let (schema, _) = pg_table_parts(&req.table);
    let (_, new_name) = pg_table_parts(&req.new_table);
    assert_pg_table(&req.new_table)?;
    let sql = format!(
      "ALTER TABLE {} RENAME TO {}",
      quote_pg_table(DEFAULT_SCHEMA, &req.table),
      quote_pg_ident(&new_name)
    );
    sqlx::query(&sql)
      .execute(&pool)
      .await
      .map_err(|e| e.to_string())?;
    Ok(pg_table_key(&schema, &new_name))
  }

  pub async fn copy_table(&self, req: &CopyTableRequest) -> Result<String, String> {
    self.schemas.lock().clear();
    let pool = self.pool(&req.database).await?;
    assert_pg_table(&req.table)?;
    assert_pg_table(&req.target_table)?;
    let (schema, _) = pg_table_parts(&req.table);
    let (_, target_name) = pg_table_parts(&req.target_table);
    let target_table = pg_table_key(&schema, &target_name);
    let sql = format!(
      "CREATE TABLE {} (LIKE {} INCLUDING ALL); INSERT INTO {} SELECT * FROM {}",
      quote_pg_table(DEFAULT_SCHEMA, &target_table),
      quote_pg_table(DEFAULT_SCHEMA, &req.table),
      quote_pg_table(DEFAULT_SCHEMA, &target_table),
      quote_pg_table(DEFAULT_SCHEMA, &req.table)
    );
    pool
      .execute(sql.as_str())
      .await
      .map_err(|e| e.to_string())?;
    Ok(target_table)
  }

  pub async fn drop_database(&self, req: &DropDatabaseRequest) -> Result<(), String> {
    self.schemas.lock().clear();
    let maybe_pool = {
      let mut guard = self.pools.lock();
      guard.remove(&req.database)
    };
    if let Some(pool) = maybe_pool {
      pool.close().await;
    }
    let pool = self.maintenance_pool().await?;
    let sql = format!("DROP DATABASE {}", quote_pg_ident(&req.database));
    sqlx::query(&sql)
      .execute(&pool)
      .await
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub async fn drop_table(&self, req: &DropTableRequest) -> Result<(), String> {
    self.schemas.lock().clear();
    let pool = self.pool(&req.database).await?;
    let sql = format!("DROP TABLE {}", quote_pg_table(DEFAULT_SCHEMA, &req.table));
    sqlx::query(&sql)
      .execute(&pool)
      .await
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub async fn truncate_table(&self, req: &TruncateTableRequest) -> Result<(), String> {
    self.schemas.lock().clear();
    let pool = self.pool(&req.database).await?;
    let table = quote_pg_table(DEFAULT_SCHEMA, &req.table);
    let sql = if req.reset_identity.unwrap_or(true) {
      format!("TRUNCATE TABLE {table} RESTART IDENTITY")
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

fn build_order(schema: &TableSchema, order_by: Option<&crate::types::OrderBy>) -> String {
  let mut parts = Vec::new();
  let mut seen = HashSet::new();
  if let Some(ob) = order_by {
    parts.push(format!("{} {}", quote_pg_ident(&ob.column), ob.dir));
    seen.insert(ob.column.clone());
  }
  let stable = if schema.primary_key.is_empty() {
    schema.columns.iter().map(|c| c.name.clone()).collect()
  } else {
    schema.primary_key.clone()
  };
  for name in stable {
    if seen.contains(&name) {
      continue;
    }
    parts.push(format!("{} ASC", quote_pg_ident(&name)));
    seen.insert(name);
  }
  if parts.is_empty() {
    String::new()
  } else {
    format!("ORDER BY {}", parts.join(", "))
  }
}
