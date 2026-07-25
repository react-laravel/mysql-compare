use std::collections::{HashMap, HashSet};

use parking_lot::Mutex;
use serde_json::Value;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::{Executor, Postgres, Row};

use crate::drivers::dialect::{
  assert_ident, assert_safe_where, clamp_page_size, quote_pg_ident, quote_pg_table,
};
use crate::drivers::util::json_from_pg_row;
use crate::types::{
  ColumnInfo, ConnectionConfig, CopyTableRequest, DatabaseInfo, DeleteRowsRequest,
  DropDatabaseRequest, DropTableRequest, ExplainPlanMetric, ExplainSQLResult, InsertRowRequest,
  QueryRowsRequest, QueryRowsResult, RenameTableRequest, TableSchema, TruncateTableRequest,
  UpdateRowRequest,
};

const DEFAULT_SCHEMA: &str = "public";

pub struct PgDriver {
  connection: ConnectionConfig,
  local_port: Option<u16>,
  pools: Mutex<HashMap<String, PgPool>>,
}

impl PgDriver {
  pub async fn open(connection: ConnectionConfig, local_port: Option<u16>) -> Result<Self, String> {
    Ok(Self {
      connection,
      local_port,
      pools: Mutex::new(HashMap::new()),
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
    let user = urlencoding(&self.connection.username);
    let pass = urlencoding(self.connection.password.as_deref().unwrap_or(""));
    format!("postgres://{user}:{pass}@{host}:{port}/{database}")
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

  async fn maintenance_pool(&self) -> Result<PgPool, String> {
    let candidates = [
      self.connection.database.clone().unwrap_or_default(),
      "postgres".into(),
      "template1".into(),
    ];
    let mut last = String::new();
    for db in candidates {
      if db.is_empty() {
        continue;
      }
      match self.pool(&db).await {
        Ok(p) => return Ok(p),
        Err(e) => last = e,
      }
    }
    Err(last)
  }

  pub async fn close(self) {
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
    Ok(format!("OK · {}", row.0.split(',').next().unwrap_or("PostgreSQL")))
  }

  pub async fn list_databases(&self) -> Result<Vec<String>, String> {
    let pool = self.maintenance_pool().await?;
    let rows = sqlx::query(
      "SELECT datname FROM pg_database
       WHERE NOT datistemplate AND datallowconn
         AND has_database_privilege(datname, 'CONNECT')
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
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'",
    )
    .bind(DEFAULT_SCHEMA)
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

  pub async fn list_tables(&self, database: &str) -> Result<Vec<String>, String> {
    let pool = self.pool(database).await?;
    let rows = sqlx::query(
      "SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name",
    )
    .bind(DEFAULT_SCHEMA)
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

  pub async fn list_foreign_key_edges(
    &self,
    database: &str,
  ) -> Result<Vec<(String, String)>, String> {
    let pool = self.pool(database).await?;
    let rows = sqlx::query(
      "SELECT DISTINCT tc.table_name AS from_table, ccu.table_name AS to_table
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1",
    )
    .bind(DEFAULT_SCHEMA)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(
      rows
        .into_iter()
        .filter_map(|r| {
          Some((
            r.try_get::<String, _>("from_table").ok()?,
            r.try_get::<String, _>("to_table").ok()?,
          ))
        })
        .collect(),
    )
  }

  pub async fn get_table_schema(&self, database: &str, table: &str) -> Result<TableSchema, String> {
    assert_ident(table, "table")?;
    let pool = self.pool(database).await?;
    let col_rows = sqlx::query(
      "SELECT column_name, data_type, is_nullable, column_default,
              udt_name
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position",
    )
    .bind(DEFAULT_SCHEMA)
    .bind(table)
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
    .bind(DEFAULT_SCHEMA)
    .bind(table)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let primary_key: Vec<String> = pk_rows
      .into_iter()
      .filter_map(|r| r.try_get::<String, _>(0).ok())
      .collect();
    let pk_set: HashSet<_> = primary_key.iter().cloned().collect();

    let columns: Vec<ColumnInfo> = col_rows
      .into_iter()
      .map(|r| {
        let name: String = r.try_get("column_name").unwrap_or_default();
        let default_value: Option<String> = r.try_get("column_default").ok();
        let is_ai = default_value
          .as_deref()
          .map(|d| d.contains("nextval") || d.to_lowercase().contains("identity"))
          .unwrap_or(false);
        ColumnInfo {
          name: name.clone(),
          col_type: r
            .try_get::<String, _>("udt_name")
            .or_else(|_| r.try_get("data_type"))
            .unwrap_or_default(),
          nullable: r
            .try_get::<String, _>("is_nullable")
            .map(|v| v == "YES")
            .unwrap_or(false),
          default_value,
          is_primary_key: pk_set.contains(&name),
          is_auto_increment: is_ai,
          comment: String::new(),
          column_key: if pk_set.contains(&name) {
            "PRI".into()
          } else {
            String::new()
          },
        }
      })
      .collect();

    let create_sql = format!(
      "-- reconstructed\nCREATE TABLE {} (...);",
      quote_pg_table(DEFAULT_SCHEMA, table)
    );

    Ok(TableSchema {
      name: table.to_string(),
      columns,
      indexes: vec![],
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

  pub async fn query_rows(&self, req: &QueryRowsRequest) -> Result<QueryRowsResult, String> {
    assert_ident(&req.table, "table")?;
    assert_safe_where(req.where_fragment())?;
    let schema = self.get_table_schema(&req.database, &req.table).await?;
    let pool = self.pool(&req.database).await?;
    let table = quote_pg_table(DEFAULT_SCHEMA, &req.table);
    let where_clause = req
      .where_fragment()
      .map(|w| format!("WHERE {w}"))
      .unwrap_or_default();
    let order_clause = build_order(&schema, req.order_by.as_ref());
    let limit = clamp_page_size(req.page_size);
    let offset = req.page.saturating_sub(1) * limit;
    let sql = format!(
      "SELECT * FROM {table} {where_clause} {order_clause} LIMIT {limit} OFFSET {offset}"
    );
    let rows = sqlx::query(&sql)
      .fetch_all(&pool)
      .await
      .map_err(|e| e.to_string())?;
    let mapped = rows
      .iter()
      .map(json_from_pg_row)
      .collect::<Result<Vec<_>, _>>()?;
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
    if req.values.is_empty() {
      return Err("No values to insert".into());
    }
    let pool = self.pool(&req.database).await?;
    let cols: Vec<_> = req.values.keys().cloned().collect();
    let placeholders = (1..=cols.len())
      .map(|i| format!("${i}"))
      .collect::<Vec<_>>()
      .join(", ");
    let col_sql = cols
      .iter()
      .map(|c| quote_pg_ident(c))
      .collect::<Vec<_>>()
      .join(", ");
    let sql = format!(
      "INSERT INTO {} ({col_sql}) VALUES ({placeholders})",
      quote_pg_table(DEFAULT_SCHEMA, &req.table)
    );
    let mut query = sqlx::query(&sql);
    for c in &cols {
      query = bind_json(query, req.values.get(c).unwrap_or(&Value::Null));
    }
    query.execute(&pool).await.map_err(|e| e.to_string())?;
    Ok(())
  }

  pub async fn update_row(&self, req: &UpdateRowRequest) -> Result<(), String> {
    if req.pk_values.is_empty() {
      return Err("Refusing to UPDATE without primary key".into());
    }
    if req.changes.is_empty() {
      return Ok(());
    }
    let pool = self.pool(&req.database).await?;
    let set_cols: Vec<_> = req.changes.keys().cloned().collect();
    let pk_cols: Vec<_> = req.pk_values.keys().cloned().collect();
    let mut idx = 1;
    let mut set_parts = Vec::new();
    for c in &set_cols {
      set_parts.push(format!("{} = ${idx}", quote_pg_ident(c)));
      idx += 1;
    }
    let mut where_parts = Vec::new();
    for c in &pk_cols {
      where_parts.push(format!("{} = ${idx}", quote_pg_ident(c)));
      idx += 1;
    }
    let sql = format!(
      "UPDATE {} SET {} WHERE {}",
      quote_pg_table(DEFAULT_SCHEMA, &req.table),
      set_parts.join(", "),
      where_parts.join(" AND ")
    );
    let mut query = sqlx::query(&sql);
    for c in &set_cols {
      query = bind_json(query, req.changes.get(c).unwrap_or(&Value::Null));
    }
    for c in &pk_cols {
      query = bind_json(query, req.pk_values.get(c).unwrap_or(&Value::Null));
    }
    query.execute(&pool).await.map_err(|e| e.to_string())?;
    Ok(())
  }

  pub async fn delete_rows(&self, req: &DeleteRowsRequest) -> Result<(), String> {
    if req.pk_rows.is_empty() {
      return Ok(());
    }
    let pool = self.pool(&req.database).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let table = quote_pg_table(DEFAULT_SCHEMA, &req.table);
    for row in &req.pk_rows {
      if row.is_empty() {
        return Err("Refusing to DELETE without primary key".into());
      }
      let cols: Vec<_> = row.keys().cloned().collect();
      let where_clause = cols
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{} = ${}", quote_pg_ident(c), i + 1))
        .collect::<Vec<_>>()
        .join(" AND ");
      let sql = format!("DELETE FROM {table} WHERE {where_clause}");
      let mut query = sqlx::query(&sql);
      for c in &cols {
        query = bind_json(query, row.get(c).unwrap_or(&Value::Null));
      }
      query.execute(&mut *tx).await.map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
  }

  pub async fn execute_sql(&self, sql: &str, database: Option<&str>) -> Result<(), String> {
    let db = database
      .map(str::to_string)
      .or_else(|| self.connection.database.clone())
      .unwrap_or_else(|| "postgres".into());
    let pool = self.pool(&db).await?;
    pool.execute(sql).await.map_err(|e| e.to_string())?;
    Ok(())
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
    let pool = self.pool(&req.database).await?;
    let sql = format!(
      "ALTER TABLE {} RENAME TO {}",
      quote_pg_table(DEFAULT_SCHEMA, &req.table),
      quote_pg_ident(&req.new_table)
    );
    sqlx::query(&sql)
      .execute(&pool)
      .await
      .map_err(|e| e.to_string())?;
    Ok(req.new_table.clone())
  }

  pub async fn copy_table(&self, req: &CopyTableRequest) -> Result<String, String> {
    let pool = self.pool(&req.database).await?;
    let sql = format!(
      "CREATE TABLE {} (LIKE {} INCLUDING ALL); INSERT INTO {} SELECT * FROM {}",
      quote_pg_table(DEFAULT_SCHEMA, &req.target_table),
      quote_pg_table(DEFAULT_SCHEMA, &req.table),
      quote_pg_table(DEFAULT_SCHEMA, &req.target_table),
      quote_pg_table(DEFAULT_SCHEMA, &req.table)
    );
    pool.execute(sql.as_str())
      .await
      .map_err(|e| e.to_string())?;
    Ok(req.target_table.clone())
  }

  pub async fn drop_database(&self, req: &DropDatabaseRequest) -> Result<(), String> {
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
    let pool = self.pool(&req.database).await?;
    let sql = format!(
      "DROP TABLE {}",
      quote_pg_table(DEFAULT_SCHEMA, &req.table)
    );
    sqlx::query(&sql)
      .execute(&pool)
      .await
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub async fn truncate_table(&self, req: &TruncateTableRequest) -> Result<(), String> {
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

  pub async fn stream_all_rows(
    &self,
    database: &str,
    table: &str,
    key_columns: &[String],
    _batch: usize,
  ) -> Result<Vec<HashMap<String, Value>>, String> {
    let pool = self.pool(database).await?;
    let order = if key_columns.is_empty() {
      String::new()
    } else {
      format!(
        "ORDER BY {}",
        key_columns
          .iter()
          .map(|c| quote_pg_ident(c))
          .collect::<Vec<_>>()
          .join(", ")
      )
    };
    let sql = format!(
      "SELECT * FROM {} {order}",
      quote_pg_table(DEFAULT_SCHEMA, table)
    );
    let rows = sqlx::query(&sql)
      .fetch_all(&pool)
      .await
      .map_err(|e| e.to_string())?;
    rows.iter().map(json_from_pg_row).collect()
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

fn bind_json<'q>(
  query: sqlx::query::Query<'q, Postgres, sqlx::postgres::PgArguments>,
  value: &'q Value,
) -> sqlx::query::Query<'q, Postgres, sqlx::postgres::PgArguments> {
  match value {
    Value::Null => query.bind(Option::<String>::None),
    Value::Bool(b) => query.bind(*b),
    Value::Number(n) => {
      if let Some(i) = n.as_i64() {
        query.bind(i)
      } else if let Some(f) = n.as_f64() {
        query.bind(f)
      } else {
        query.bind(n.to_string())
      }
    }
    Value::String(s) => query.bind(s.as_str()),
    other => query.bind(other.to_string()),
  }
}

fn urlencoding(s: &str) -> String {
  let mut out = String::new();
  for b in s.bytes() {
    match b {
      b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
      _ => out.push_str(&format!("%{b:02X}")),
    }
  }
  out
}
