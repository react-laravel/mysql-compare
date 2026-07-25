use std::collections::HashMap;

use redis::AsyncCommands;
use serde_json::{json, Value};

use crate::types::{
  ColumnInfo, ConnectionConfig, DatabaseInfo, DeleteRowsRequest, DropTableRequest,
  InsertRowRequest, QueryRowsRequest, QueryRowsResult, RenameTableRequest, TableSchema,
  UpdateRowRequest,
};

const MAX_KEYS: usize = 10_000;

pub struct RedisDriver {
  connection: ConnectionConfig,
  local_port: Option<u16>,
  client: redis::Client,
}

impl RedisDriver {
  pub async fn open(connection: ConnectionConfig, local_port: Option<u16>) -> Result<Self, String> {
    let (host, port) = if let Some(p) = local_port {
      ("127.0.0.1".to_string(), p)
    } else {
      (connection.host.clone(), connection.port)
    };
    let db: i64 = connection
      .database
      .as_deref()
      .unwrap_or("0")
      .parse()
      .unwrap_or(0);
    let password = connection.password.clone().unwrap_or_default();
    let url = if password.is_empty() {
      format!("redis://{host}:{port}/{db}")
    } else {
      format!("redis://:{password}@{host}:{port}/{db}")
    };
    let client = redis::Client::open(url).map_err(|e| e.to_string())?;
    Ok(Self {
      connection,
      local_port,
      client,
    })
  }

  async fn conn(&self) -> Result<redis::aio::MultiplexedConnection, String> {
    self
      .client
      .get_multiplexed_async_connection()
      .await
      .map_err(|e| e.to_string())
  }

  pub async fn close(self) {}

  pub async fn test(&self) -> Result<String, String> {
    let mut c = self.conn().await?;
    let pong: String = redis::cmd("PING")
      .query_async(&mut c)
      .await
      .map_err(|e| e.to_string())?;
    Ok(format!("OK · Redis {pong}"))
  }

  pub async fn list_databases(&self) -> Result<Vec<String>, String> {
    let mut c = self.conn().await?;
    let result: Vec<String> = redis::cmd("CONFIG")
      .arg("GET")
      .arg("databases")
      .query_async(&mut c)
      .await
      .unwrap_or_default();
    if result.len() >= 2 {
      if let Ok(n) = result[1].parse::<usize>() {
        return Ok((0..n).map(|i| i.to_string()).collect());
      }
    }
    Ok(vec![self
      .connection
      .database
      .clone()
      .unwrap_or_else(|| "0".into())])
  }

  pub async fn get_database_info(&self, database: &str) -> Result<DatabaseInfo, String> {
    let mut c = self.conn_for_db(database).await?;
    let size: i64 = redis::cmd("DBSIZE")
      .query_async(&mut c)
      .await
      .unwrap_or(0);
    Ok(DatabaseInfo {
      name: database.to_string(),
      table_count: size,
      row_estimate: Some(size),
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

  async fn conn_for_db(&self, database: &str) -> Result<redis::aio::MultiplexedConnection, String> {
    let db: i64 = database.parse().unwrap_or(0);
    let (host, port) = if let Some(p) = self.local_port {
      ("127.0.0.1".to_string(), p)
    } else {
      (self.connection.host.clone(), self.connection.port)
    };
    let password = self.connection.password.clone().unwrap_or_default();
    let url = if password.is_empty() {
      format!("redis://{host}:{port}/{db}")
    } else {
      format!("redis://:{password}@{host}:{port}/{db}")
    };
    redis::Client::open(url)
      .map_err(|e| e.to_string())?
      .get_multiplexed_async_connection()
      .await
      .map_err(|e| e.to_string())
  }

  pub async fn list_tables(&self, database: &str) -> Result<Vec<String>, String> {
    let mut c = self.conn_for_db(database).await?;
    let mut cursor: u64 = 0;
    let mut keys = Vec::new();
    loop {
      let (next, batch): (u64, Vec<String>) = redis::cmd("SCAN")
        .arg(cursor)
        .arg("COUNT")
        .arg(1000)
        .query_async(&mut c)
        .await
        .map_err(|e| e.to_string())?;
      keys.extend(batch);
      cursor = next;
      if cursor == 0 || keys.len() >= MAX_KEYS {
        break;
      }
    }
    keys.sort();
    keys.truncate(MAX_KEYS);
    Ok(keys)
  }

  pub async fn get_table_schema(&self, _database: &str, table: &str) -> Result<TableSchema, String> {
    Ok(TableSchema {
      name: table.to_string(),
      columns: vec![
        ColumnInfo {
          name: "key".into(),
          col_type: "string".into(),
          nullable: false,
          default_value: None,
          is_primary_key: true,
          is_auto_increment: false,
          comment: String::new(),
          column_key: "PRI".into(),
        },
        ColumnInfo {
          name: "value".into(),
          col_type: "string".into(),
          nullable: true,
          default_value: None,
          is_primary_key: false,
          is_auto_increment: false,
          comment: String::new(),
          column_key: String::new(),
        },
      ],
      indexes: vec![],
      primary_key: vec!["key".into()],
      create_sql: String::new(),
      row_estimate: Some(1),
      engine: Some("redis".into()),
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
    let mut c = self.conn_for_db(&req.database).await?;
    let key_type: String = redis::cmd("TYPE")
      .arg(&req.table)
      .query_async(&mut c)
      .await
      .unwrap_or_else(|_| "none".into());
    let mut rows = Vec::new();
    let mut columns = vec![];
    let mut primary_key = vec![];
    match key_type.as_str() {
      "string" => {
        let value: String = c.get(&req.table).await.unwrap_or_default();
        let ttl: i64 = redis::cmd("TTL")
          .arg(&req.table)
          .query_async(&mut c)
          .await
          .unwrap_or(-1);
        if req.page <= 1 {
          rows.push(HashMap::from([
            ("key".into(), Value::String(req.table.clone())),
            ("value".into(), Value::String(value)),
            ("ttlSeconds".into(), json!(ttl)),
          ]));
        }
        columns = self.get_table_schema(&req.database, &req.table).await?.columns;
        primary_key = vec!["key".into()];
      }
      "hash" => {
        let map: HashMap<String, String> = c.hgetall(&req.table).await.unwrap_or_default();
        let mut entries: Vec<_> = map.into_iter().collect();
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let total = entries.len();
        let start = ((req.page.saturating_sub(1)) * req.page_size) as usize;
        let end = (start + req.page_size as usize).min(total);
        for (field, value) in entries.into_iter().skip(start).take(end.saturating_sub(start)) {
          rows.push(HashMap::from([
            ("field".into(), Value::String(field)),
            ("value".into(), Value::String(value)),
          ]));
        }
        columns = vec![
          col("field", true),
          col("value", false),
        ];
        primary_key = vec!["field".into()];
        return Ok(QueryRowsResult {
          rows,
          total: total as i64,
          has_primary_key: true,
          primary_key,
          columns,
        });
      }
      "list" => {
        let len: isize = c.llen(&req.table).await.unwrap_or(0);
        let start = ((req.page.saturating_sub(1)) * req.page_size) as isize;
        let stop = start + req.page_size as isize - 1;
        let values: Vec<String> = c.lrange(&req.table, start, stop).await.unwrap_or_default();
        for (i, value) in values.into_iter().enumerate() {
          rows.push(HashMap::from([
            ("index".into(), json!(start + i as isize)),
            ("value".into(), Value::String(value)),
          ]));
        }
        return Ok(QueryRowsResult {
          rows,
          total: len as i64,
          has_primary_key: true,
          primary_key: vec!["index".into()],
          columns: vec![col("index", true), col("value", false)],
        });
      }
      "set" => {
        let members: Vec<String> = c.smembers(&req.table).await.unwrap_or_default();
        let mut members = members;
        members.sort();
        let total = members.len();
        let start = ((req.page.saturating_sub(1)) * req.page_size) as usize;
        for member in members.into_iter().skip(start).take(req.page_size as usize) {
          rows.push(HashMap::from([("member".into(), Value::String(member))]));
        }
        return Ok(QueryRowsResult {
          rows,
          total: total as i64,
          has_primary_key: true,
          primary_key: vec!["member".into()],
          columns: vec![col("member", true)],
        });
      }
      "zset" => {
        let start = ((req.page.saturating_sub(1)) * req.page_size) as isize;
        let stop = start + req.page_size as isize - 1;
        let values: Vec<(String, f64)> = redis::cmd("ZRANGE")
          .arg(&req.table)
          .arg(start)
          .arg(stop)
          .arg("WITHSCORES")
          .query_async(&mut c)
          .await
          .unwrap_or_default();
        let card: i64 = c.zcard(&req.table).await.unwrap_or(0);
        for (member, score) in values {
          rows.push(HashMap::from([
            ("member".into(), Value::String(member)),
            ("score".into(), json!(score)),
          ]));
        }
        return Ok(QueryRowsResult {
          rows,
          total: card,
          has_primary_key: true,
          primary_key: vec!["member".into()],
          columns: vec![col("member", true), col("score", false)],
        });
      }
      _ => {}
    }
    let total = rows.len() as i64;
    Ok(QueryRowsResult {
      rows,
      total,
      has_primary_key: true,
      primary_key,
      columns,
    })
  }

  pub async fn insert_row(&self, req: &InsertRowRequest) -> Result<(), String> {
    let mut c = self.conn_for_db(&req.database).await?;
    if let Some(Value::String(value)) = req.values.get("value") {
      let _: () = c.set(&req.table, value).await.map_err(|e| e.to_string())?;
      return Ok(());
    }
    if let (Some(Value::String(field)), Some(Value::String(value))) =
      (req.values.get("field"), req.values.get("value"))
    {
      let _: () = c
        .hset(&req.table, field, value)
        .await
        .map_err(|e| e.to_string())?;
      return Ok(());
    }
    Err("Unsupported Redis insert payload".into())
  }

  pub async fn update_row(&self, req: &UpdateRowRequest) -> Result<(), String> {
    self
      .insert_row(&InsertRowRequest {
        connection_id: req.connection_id.clone(),
        database: req.database.clone(),
        table: req.table.clone(),
        values: req.changes.clone(),
      })
      .await
  }

  pub async fn delete_rows(&self, req: &DeleteRowsRequest) -> Result<(), String> {
    let mut c = self.conn_for_db(&req.database).await?;
    if req.pk_rows.is_empty() {
      let _: () = redis::cmd("DEL")
        .arg(&req.table)
        .query_async(&mut c)
        .await
        .map_err(|e| e.to_string())?;
      return Ok(());
    }
    for row in &req.pk_rows {
      if let Some(Value::String(field)) = row.get("field") {
        let _: () = c.hdel(&req.table, field).await.map_err(|e| e.to_string())?;
      } else if let Some(Value::String(member)) = row.get("member") {
        let _: () = c.srem(&req.table, member).await.map_err(|e| e.to_string())?;
      }
    }
    Ok(())
  }

  pub async fn rename_table(&self, req: &RenameTableRequest) -> Result<String, String> {
    let mut c = self.conn_for_db(&req.database).await?;
    let _: () = redis::cmd("RENAME")
      .arg(&req.table)
      .arg(&req.new_table)
      .query_async(&mut c)
      .await
      .map_err(|e| e.to_string())?;
    Ok(req.new_table.clone())
  }

  pub async fn drop_table(&self, req: &DropTableRequest) -> Result<(), String> {
    let mut c = self.conn_for_db(&req.database).await?;
    let _: () = redis::cmd("DEL")
      .arg(&req.table)
      .query_async(&mut c)
      .await
      .map_err(|e| e.to_string())?;
    Ok(())
  }
}

fn col(name: &str, pk: bool) -> ColumnInfo {
  ColumnInfo {
    name: name.into(),
    col_type: "string".into(),
    nullable: !pk,
    default_value: None,
    is_primary_key: pk,
    is_auto_increment: false,
    comment: String::new(),
    column_key: if pk { "PRI".into() } else { String::new() },
  }
}
