use std::collections::HashMap;

use redis::AsyncCommands;
use serde_json::{json, Value};

use crate::drivers::util::urlencoding;
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
    let url = build_url(&host, port, db, &password);
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

  pub async fn close(&self) {}

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
    let url = build_url(&host, port, db, &password);
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
    let ops = plan_insert_ops(&req.values)?;
    let mut c = self.conn_for_db(&req.database).await?;
    apply_ops(&mut c, &req.table, &ops).await
  }

  pub async fn update_row(&self, req: &UpdateRowRequest) -> Result<(), String> {
    let ops = plan_update_ops(&req.pk_values, &req.changes)?;
    let mut c = self.conn_for_db(&req.database).await?;
    apply_ops(&mut c, &req.table, &ops).await
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

fn build_url(host: &str, port: u16, db: i64, password: &str) -> String {
  if password.is_empty() {
    format!("redis://{host}:{port}/{db}")
  } else {
    format!("redis://:{}@{host}:{port}/{db}", urlencoding(password))
  }
}

/// 计划好的单条 Redis 写命令（纯数据，便于单测）。
#[derive(Debug, Clone, PartialEq)]
enum RedisWriteOp {
  Set { value: String },
  RPush { value: String },
  HSet { field: String, value: String },
  HDel { field: String },
  /// hash 字段改名但未提供新值：执行时先 HGET 旧值再搬移。
  HRename { from: String, to: String },
  LSet { index: i64, value: String },
  SAdd { member: String },
  SRem { member: String },
  ZAdd { member: String, score: f64 },
  ZRem { member: String },
  XAdd { fields: Vec<(String, String)> },
  Expire { seconds: i64 },
}

fn value_as_string(value: Option<&Value>) -> Option<String> {
  match value? {
    Value::String(s) => Some(s.clone()),
    Value::Number(n) => Some(n.to_string()),
    Value::Bool(b) => Some(b.to_string()),
    Value::Null => None,
    other => Some(other.to_string()),
  }
}

fn value_as_i64(value: Option<&Value>) -> Option<i64> {
  match value? {
    Value::Number(n) => n.as_i64(),
    Value::String(s) => s.trim().parse().ok(),
    _ => None,
  }
}

fn value_as_f64(value: Option<&Value>) -> Option<f64> {
  match value? {
    Value::Number(n) => n.as_f64(),
    Value::String(s) => s.trim().parse().ok(),
    _ => None,
  }
}

fn ttl_op(values: &HashMap<String, Value>) -> Option<RedisWriteOp> {
  let seconds = value_as_i64(values.get("ttlSeconds"))?;
  (seconds > 0).then_some(RedisWriteOp::Expire { seconds })
}

/// 根据插入 payload 的形状（最特化优先）规划写命令：
/// field+value -> HSET；member+score -> ZADD；member -> SADD；
/// fields 对象 -> XADD；纯 value -> SET（type 提示为 list 时 RPUSH）。
fn plan_insert_ops(values: &HashMap<String, Value>) -> Result<Vec<RedisWriteOp>, String> {
  let field = value_as_string(values.get("field"));
  let member = value_as_string(values.get("member"));
  let value = value_as_string(values.get("value"));
  let score = value_as_f64(values.get("score"));
  let type_hint = value_as_string(values.get("type"));

  let mut ops = Vec::new();
  if let (Some(field), Some(value)) = (field, value.clone()) {
    ops.push(RedisWriteOp::HSet { field, value });
  } else if let (Some(member), Some(score)) = (member.clone(), score) {
    ops.push(RedisWriteOp::ZAdd { member, score });
  } else if let Some(member) = member {
    ops.push(RedisWriteOp::SAdd { member });
  } else if let Some(Value::Object(fields)) = values.get("fields") {
    let fields: Vec<(String, String)> = fields
      .iter()
      .map(|(name, v)| (name.clone(), value_as_string(Some(v)).unwrap_or_default()))
      .collect();
    ops.push(RedisWriteOp::XAdd { fields });
  } else if let Some(value) = value {
    if type_hint.as_deref() == Some("list") {
      ops.push(RedisWriteOp::RPush { value });
    } else {
      ops.push(RedisWriteOp::Set { value });
    }
  } else {
    return Err("Unsupported Redis insert payload".into());
  }
  if let Some(op) = ttl_op(values) {
    ops.push(op);
  }
  Ok(ops)
}

/// 根据行主键定位元素后规划更新命令，主键语义与 query_rows 一致：
/// hash -> field、list -> index、set/zset -> member、string -> key。
/// 绝不退化为整键 SET（那会把 hash/list 整个覆盖掉）。
fn plan_update_ops(
  pk_values: &HashMap<String, Value>,
  changes: &HashMap<String, Value>,
) -> Result<Vec<RedisWriteOp>, String> {
  let mut ops = Vec::new();
  if let Some(field) = value_as_string(pk_values.get("field")) {
    let next_field = value_as_string(changes.get("field")).filter(|f| *f != field);
    let value = value_as_string(changes.get("value"));
    match (next_field, value) {
      (Some(next), Some(value)) => {
        ops.push(RedisWriteOp::HDel { field });
        ops.push(RedisWriteOp::HSet { field: next, value });
      }
      (Some(next), None) => ops.push(RedisWriteOp::HRename {
        from: field,
        to: next,
      }),
      (None, Some(value)) => ops.push(RedisWriteOp::HSet { field, value }),
      (None, None) => {}
    }
  } else if let Some(index) = value_as_i64(pk_values.get("index")) {
    if let Some(value) = value_as_string(changes.get("value")) {
      ops.push(RedisWriteOp::LSet { index, value });
    }
  } else if let Some(member) = value_as_string(pk_values.get("member")) {
    let next_member = value_as_string(changes.get("member")).filter(|m| *m != member);
    if let Some(score) = value_as_f64(changes.get("score")) {
      // zset：改分数（member 同时改名时先移除旧成员）
      if let Some(next) = next_member {
        ops.push(RedisWriteOp::ZRem { member });
        ops.push(RedisWriteOp::ZAdd {
          member: next,
          score,
        });
      } else {
        ops.push(RedisWriteOp::ZAdd { member, score });
      }
    } else if let Some(next) = next_member {
      // set：改成员
      ops.push(RedisWriteOp::SRem { member });
      ops.push(RedisWriteOp::SAdd { member: next });
    }
  } else if let Some(value) = value_as_string(changes.get("value")) {
    // string 键：pk 为 key 本身
    ops.push(RedisWriteOp::Set { value });
  }
  if let Some(op) = ttl_op(changes) {
    ops.push(op);
  }
  Ok(ops)
}

async fn apply_ops(
  c: &mut redis::aio::MultiplexedConnection,
  key: &str,
  ops: &[RedisWriteOp],
) -> Result<(), String> {
  for op in ops {
    match op {
      RedisWriteOp::Set { value } => {
        let _: () = c.set(key, value).await.map_err(|e| e.to_string())?;
      }
      RedisWriteOp::RPush { value } => {
        let _: () = c.rpush(key, value).await.map_err(|e| e.to_string())?;
      }
      RedisWriteOp::HSet { field, value } => {
        let _: () = c.hset(key, field, value).await.map_err(|e| e.to_string())?;
      }
      RedisWriteOp::HDel { field } => {
        let _: () = c.hdel(key, field).await.map_err(|e| e.to_string())?;
      }
      RedisWriteOp::HRename { from, to } => {
        let current: Option<String> = c.hget(key, from).await.map_err(|e| e.to_string())?;
        let value = current.ok_or_else(|| format!("Hash field \"{from}\" not found"))?;
        let _: () = c.hdel(key, from).await.map_err(|e| e.to_string())?;
        let _: () = c.hset(key, to, value).await.map_err(|e| e.to_string())?;
      }
      RedisWriteOp::LSet { index, value } => {
        let _: () = c
          .lset(key, *index as isize, value)
          .await
          .map_err(|e| e.to_string())?;
      }
      RedisWriteOp::SAdd { member } => {
        let _: () = c.sadd(key, member).await.map_err(|e| e.to_string())?;
      }
      RedisWriteOp::SRem { member } => {
        let _: () = c.srem(key, member).await.map_err(|e| e.to_string())?;
      }
      RedisWriteOp::ZAdd { member, score } => {
        let _: () = c
          .zadd(key, member, *score)
          .await
          .map_err(|e| e.to_string())?;
      }
      RedisWriteOp::ZRem { member } => {
        let _: () = c.zrem(key, member).await.map_err(|e| e.to_string())?;
      }
      RedisWriteOp::XAdd { fields } => {
        let mut cmd = redis::cmd("XADD");
        cmd.arg(key).arg("*");
        for (name, value) in fields {
          cmd.arg(name).arg(value);
        }
        let _: String = cmd.query_async(c).await.map_err(|e| e.to_string())?;
      }
      RedisWriteOp::Expire { seconds } => {
        let _: () = c.expire(key, *seconds).await.map_err(|e| e.to_string())?;
      }
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn values(entries: &[(&str, Value)]) -> HashMap<String, Value> {
    entries
      .iter()
      .map(|(k, v)| (k.to_string(), v.clone()))
      .collect()
  }

  #[test]
  fn build_url_percent_encodes_password() {
    assert_eq!(
      build_url("localhost", 6379, 2, "p@ss:w/rd"),
      "redis://:p%40ss%3Aw%2Frd@localhost:6379/2"
    );
    assert_eq!(build_url("localhost", 6379, 0, ""), "redis://localhost:6379/0");
  }

  #[test]
  fn insert_hash_payload_uses_hset_not_set() {
    // 之前 value 分支在 field+value 之前命中，把 hash 键整个覆盖成 string。
    let ops = plan_insert_ops(&values(&[
      ("key", json!("k")),
      ("type", json!("hash")),
      ("field", json!("name")),
      ("value", json!("doge")),
    ]))
    .unwrap();
    assert_eq!(
      ops,
      vec![RedisWriteOp::HSet {
        field: "name".into(),
        value: "doge".into()
      }]
    );
  }

  #[test]
  fn insert_zset_payload_uses_zadd() {
    let ops = plan_insert_ops(&values(&[
      ("member", json!("m1")),
      ("score", json!(1.5)),
    ]))
    .unwrap();
    assert_eq!(
      ops,
      vec![RedisWriteOp::ZAdd {
        member: "m1".into(),
        score: 1.5
      }]
    );
  }

  #[test]
  fn insert_set_payload_uses_sadd() {
    let ops = plan_insert_ops(&values(&[("member", json!("m1"))])).unwrap();
    assert_eq!(ops, vec![RedisWriteOp::SAdd { member: "m1".into() }]);
  }

  #[test]
  fn insert_stream_payload_uses_xadd() {
    let ops = plan_insert_ops(&values(&[(
      "fields",
      json!({ "a": "1", "b": 2 }),
    )]))
    .unwrap();
    assert_eq!(
      ops,
      vec![RedisWriteOp::XAdd {
        fields: vec![("a".into(), "1".into()), ("b".into(), "2".into())]
      }]
    );
  }

  #[test]
  fn insert_list_type_hint_uses_rpush() {
    let ops = plan_insert_ops(&values(&[
      ("type", json!("list")),
      ("value", json!("v1")),
    ]))
    .unwrap();
    assert_eq!(ops, vec![RedisWriteOp::RPush { value: "v1".into() }]);
  }

  #[test]
  fn insert_bare_value_uses_set_and_applies_ttl() {
    let ops = plan_insert_ops(&values(&[
      ("value", json!("v1")),
      ("ttlSeconds", json!(60)),
    ]))
    .unwrap();
    assert_eq!(
      ops,
      vec![
        RedisWriteOp::Set { value: "v1".into() },
        RedisWriteOp::Expire { seconds: 60 }
      ]
    );
  }

  #[test]
  fn insert_without_recognizable_payload_errors() {
    assert!(plan_insert_ops(&values(&[("key", json!("k"))])).is_err());
  }

  #[test]
  fn update_hash_value_targets_pk_field_not_whole_key() {
    // 回归：以前 update 委托 insert_row，把整个 hash 覆盖成 string（数据丢失）。
    let ops = plan_update_ops(
      &values(&[("field", json!("name"))]),
      &values(&[("value", json!("doge"))]),
    )
    .unwrap();
    assert_eq!(
      ops,
      vec![RedisWriteOp::HSet {
        field: "name".into(),
        value: "doge".into()
      }]
    );
  }

  #[test]
  fn update_hash_field_rename_with_value_moves_entry() {
    let ops = plan_update_ops(
      &values(&[("field", json!("old"))]),
      &values(&[("field", json!("new")), ("value", json!("v"))]),
    )
    .unwrap();
    assert_eq!(
      ops,
      vec![
        RedisWriteOp::HDel { field: "old".into() },
        RedisWriteOp::HSet {
          field: "new".into(),
          value: "v".into()
        }
      ]
    );
  }

  #[test]
  fn update_hash_field_rename_without_value_uses_hrename() {
    let ops = plan_update_ops(
      &values(&[("field", json!("old"))]),
      &values(&[("field", json!("new"))]),
    )
    .unwrap();
    assert_eq!(
      ops,
      vec![RedisWriteOp::HRename {
        from: "old".into(),
        to: "new".into()
      }]
    );
  }

  #[test]
  fn update_list_row_uses_lset_by_index() {
    let ops = plan_update_ops(
      &values(&[("index", json!(3))]),
      &values(&[("value", json!("v"))]),
    )
    .unwrap();
    assert_eq!(
      ops,
      vec![RedisWriteOp::LSet {
        index: 3,
        value: "v".into()
      }]
    );
  }

  #[test]
  fn update_zset_score_uses_zadd_with_pk_member() {
    let ops = plan_update_ops(
      &values(&[("member", json!("m1"))]),
      &values(&[("score", json!(2))]),
    )
    .unwrap();
    assert_eq!(
      ops,
      vec![RedisWriteOp::ZAdd {
        member: "m1".into(),
        score: 2.0
      }]
    );
  }

  #[test]
  fn update_set_member_rename_removes_then_adds() {
    let ops = plan_update_ops(
      &values(&[("member", json!("old"))]),
      &values(&[("member", json!("new"))]),
    )
    .unwrap();
    assert_eq!(
      ops,
      vec![
        RedisWriteOp::SRem { member: "old".into() },
        RedisWriteOp::SAdd { member: "new".into() }
      ]
    );
  }

  #[test]
  fn update_string_value_uses_set() {
    let ops = plan_update_ops(
      &values(&[("key", json!("k"))]),
      &values(&[("value", json!("v"))]),
    )
    .unwrap();
    assert_eq!(ops, vec![RedisWriteOp::Set { value: "v".into() }]);
  }

  #[test]
  fn update_with_only_ttl_change_applies_expire() {
    let ops = plan_update_ops(
      &values(&[("key", json!("k"))]),
      &values(&[("ttlSeconds", json!(30))]),
    )
    .unwrap();
    assert_eq!(ops, vec![RedisWriteOp::Expire { seconds: 30 }]);
  }
}
