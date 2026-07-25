pub mod dialect;
pub mod mysql;
pub mod pg;
pub mod redis;
pub mod util;

use crate::types::{
  ConnectionConfig, CopyTableRequest, DatabaseInfo, DeleteRowsRequest, DropDatabaseRequest,
  DropTableRequest, ExplainSQLResult, InsertRowRequest, QueryRowsRequest, QueryRowsResult,
  RenameTableRequest, TableSchema, TruncateTableRequest, UpdateRowRequest,
};

pub enum EngineDriver {
  Mysql(mysql::MysqlDriver),
  Postgres(pg::PgDriver),
  Redis(redis::RedisDriver),
}

impl EngineDriver {
  pub async fn open(conn: ConnectionConfig, local_port: Option<u16>) -> Result<Self, String> {
    match conn.engine {
      crate::types::DbEngine::Mysql => Ok(Self::Mysql(mysql::MysqlDriver::open(conn, local_port).await?)),
      crate::types::DbEngine::Postgres => {
        Ok(Self::Postgres(pg::PgDriver::open(conn, local_port).await?))
      }
      crate::types::DbEngine::Redis => Ok(Self::Redis(redis::RedisDriver::open(conn, local_port).await?)),
    }
  }

  pub async fn test_connection(conn: &ConnectionConfig, local_port: Option<u16>) -> Result<String, String> {
    let driver = Self::open(conn.clone(), local_port).await?;
    let msg = match &driver {
      Self::Mysql(d) => d.test().await?,
      Self::Postgres(d) => d.test().await?,
      Self::Redis(d) => d.test().await?,
    };
    driver.close().await;
    Ok(msg)
  }

  pub async fn close(self) {
    match self {
      Self::Mysql(d) => d.close().await,
      Self::Postgres(d) => d.close().await,
      Self::Redis(d) => d.close().await,
    }
  }

  pub async fn list_databases(&self) -> Result<Vec<String>, String> {
    match self {
      Self::Mysql(d) => d.list_databases().await,
      Self::Postgres(d) => d.list_databases().await,
      Self::Redis(d) => d.list_databases().await,
    }
  }

  pub async fn get_database_info(&self, database: &str) -> Result<DatabaseInfo, String> {
    match self {
      Self::Mysql(d) => d.get_database_info(database).await,
      Self::Postgres(d) => d.get_database_info(database).await,
      Self::Redis(d) => d.get_database_info(database).await,
    }
  }

  pub async fn list_tables(&self, database: &str) -> Result<Vec<String>, String> {
    match self {
      Self::Mysql(d) => d.list_tables(database).await,
      Self::Postgres(d) => d.list_tables(database).await,
      Self::Redis(d) => d.list_tables(database).await,
    }
  }

  pub async fn get_table_schema(&self, database: &str, table: &str) -> Result<TableSchema, String> {
    match self {
      Self::Mysql(d) => d.get_table_schema(database, table).await,
      Self::Postgres(d) => d.get_table_schema(database, table).await,
      Self::Redis(d) => d.get_table_schema(database, table).await,
    }
  }

  pub async fn query_rows(&self, req: &QueryRowsRequest) -> Result<QueryRowsResult, String> {
    match self {
      Self::Mysql(d) => d.query_rows(req).await,
      Self::Postgres(d) => d.query_rows(req).await,
      Self::Redis(d) => d.query_rows(req).await,
    }
  }

  pub async fn insert_row(&self, req: &InsertRowRequest) -> Result<(), String> {
    match self {
      Self::Mysql(d) => d.insert_row(req).await,
      Self::Postgres(d) => d.insert_row(req).await,
      Self::Redis(d) => d.insert_row(req).await,
    }
  }

  pub async fn update_row(&self, req: &UpdateRowRequest) -> Result<(), String> {
    match self {
      Self::Mysql(d) => d.update_row(req).await,
      Self::Postgres(d) => d.update_row(req).await,
      Self::Redis(d) => d.update_row(req).await,
    }
  }

  pub async fn delete_rows(&self, req: &DeleteRowsRequest) -> Result<(), String> {
    match self {
      Self::Mysql(d) => d.delete_rows(req).await,
      Self::Postgres(d) => d.delete_rows(req).await,
      Self::Redis(d) => d.delete_rows(req).await,
    }
  }

  pub async fn execute_sql(&self, sql: &str, database: Option<&str>) -> Result<(), String> {
    match self {
      Self::Mysql(d) => d.execute_sql(sql, database).await,
      Self::Postgres(d) => d.execute_sql(sql, database).await,
      Self::Redis(_) => Err("Redis does not support SQL".into()),
    }
  }

  pub async fn explain_sql(
    &self,
    sql: &str,
    database: Option<&str>,
  ) -> Result<ExplainSQLResult, String> {
    match self {
      Self::Mysql(d) => d.explain_sql(sql, database).await,
      Self::Postgres(d) => d.explain_sql(sql, database).await,
      Self::Redis(_) => Err("Redis does not support EXPLAIN".into()),
    }
  }

  pub async fn rename_table(&self, req: &RenameTableRequest) -> Result<String, String> {
    match self {
      Self::Mysql(d) => d.rename_table(req).await,
      Self::Postgres(d) => d.rename_table(req).await,
      Self::Redis(d) => d.rename_table(req).await,
    }
  }

  pub async fn copy_table(&self, req: &CopyTableRequest) -> Result<String, String> {
    match self {
      Self::Mysql(d) => d.copy_table(req).await,
      Self::Postgres(d) => d.copy_table(req).await,
      Self::Redis(_) => Err("Redis does not support copy table".into()),
    }
  }

  pub async fn drop_database(&self, req: &DropDatabaseRequest) -> Result<(), String> {
    match self {
      Self::Mysql(d) => d.drop_database(req).await,
      Self::Postgres(d) => d.drop_database(req).await,
      Self::Redis(_) => Err("Redis does not support drop database".into()),
    }
  }

  pub async fn drop_table(&self, req: &DropTableRequest) -> Result<(), String> {
    match self {
      Self::Mysql(d) => d.drop_table(req).await,
      Self::Postgres(d) => d.drop_table(req).await,
      Self::Redis(d) => d.drop_table(req).await,
    }
  }

  pub async fn truncate_table(&self, req: &TruncateTableRequest) -> Result<(), String> {
    match self {
      Self::Mysql(d) => d.truncate_table(req).await,
      Self::Postgres(d) => d.truncate_table(req).await,
      Self::Redis(_) => Err("Redis does not support truncate".into()),
    }
  }

  pub async fn list_foreign_key_edges(
    &self,
    database: &str,
  ) -> Result<Vec<(String, String)>, String> {
    match self {
      Self::Mysql(d) => d.list_foreign_key_edges(database).await,
      Self::Postgres(d) => d.list_foreign_key_edges(database).await,
      Self::Redis(_) => Ok(vec![]),
    }
  }

  pub async fn stream_rows_ordered(
    &self,
    database: &str,
    table: &str,
    key_columns: &[String],
    batch: usize,
  ) -> Result<Vec<std::collections::HashMap<String, serde_json::Value>>, String> {
    match self {
      Self::Mysql(d) => d.stream_all_rows(database, table, key_columns, batch).await,
      Self::Postgres(d) => d.stream_all_rows(database, table, key_columns, batch).await,
      Self::Redis(_) => Err("Redis does not support stream rows for sync".into()),
    }
  }
}
