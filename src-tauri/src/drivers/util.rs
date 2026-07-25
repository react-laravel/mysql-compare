use serde_json::{Map, Number, Value};
use sqlx::Column;
use sqlx::Row;
use sqlx::TypeInfo;
use sqlx::ValueRef;

pub fn json_from_mysql_row(row: &sqlx::mysql::MySqlRow) -> Result<std::collections::HashMap<String, Value>, String> {
  let mut map = std::collections::HashMap::new();
  for col in row.columns() {
    let name = col.name().to_string();
    let value = mysql_value(row, col.ordinal())?;
    map.insert(name, value);
  }
  Ok(map)
}

fn mysql_value(row: &sqlx::mysql::MySqlRow, index: usize) -> Result<Value, String> {
  let raw = row.try_get_raw(index).map_err(|e| e.to_string())?;
  if raw.is_null() {
    return Ok(Value::Null);
  }
  let type_name = raw.type_info().name().to_lowercase();
  if type_name.contains("int") {
    if let Ok(v) = row.try_get::<i64, _>(index) {
      return Ok(Value::Number(v.into()));
    }
    if let Ok(v) = row.try_get::<u64, _>(index) {
      return Ok(Value::Number(v.into()));
    }
  }
  if type_name.contains("decimal") || type_name.contains("float") || type_name.contains("double") {
    if let Ok(v) = row.try_get::<f64, _>(index) {
      return Ok(Number::from_f64(v).map(Value::Number).unwrap_or(Value::Null));
    }
  }
  if type_name == "tinyint" {
    if let Ok(v) = row.try_get::<i64, _>(index) {
      return Ok(Value::Number(v.into()));
    }
  }
  if let Ok(v) = row.try_get::<bool, _>(index) {
    return Ok(Value::Bool(v));
  }
  if let Ok(v) = row.try_get::<Vec<u8>, _>(index) {
    if type_name.contains("blob") || type_name.contains("binary") {
      return Ok(Value::Object(Map::from_iter([
        ("type".into(), Value::String("Buffer".into())),
        ("hex".into(), Value::String(hex::encode(v))),
      ])));
    }
    if let Ok(s) = String::from_utf8(v.clone()) {
      return Ok(Value::String(s));
    }
    return Ok(Value::String(hex::encode(v)));
  }
  if let Ok(v) = row.try_get::<String, _>(index) {
    return Ok(Value::String(v));
  }
  Ok(Value::Null)
}

pub fn json_from_pg_row(row: &sqlx::postgres::PgRow) -> Result<std::collections::HashMap<String, Value>, String> {
  let mut map = std::collections::HashMap::new();
  for col in row.columns() {
    let name = col.name().to_string();
    let value = pg_value(row, col.ordinal())?;
    map.insert(name, value);
  }
  Ok(map)
}

fn pg_value(row: &sqlx::postgres::PgRow, index: usize) -> Result<Value, String> {
  let raw = row.try_get_raw(index).map_err(|e| e.to_string())?;
  if raw.is_null() {
    return Ok(Value::Null);
  }
  if let Ok(v) = row.try_get::<i64, _>(index) {
    return Ok(Value::Number(v.into()));
  }
  if let Ok(v) = row.try_get::<f64, _>(index) {
    return Ok(Number::from_f64(v).map(Value::Number).unwrap_or(Value::Null));
  }
  if let Ok(v) = row.try_get::<bool, _>(index) {
    return Ok(Value::Bool(v));
  }
  if let Ok(v) = row.try_get::<serde_json::Value, _>(index) {
    return Ok(v);
  }
  if let Ok(v) = row.try_get::<String, _>(index) {
    return Ok(Value::String(v));
  }
  if let Ok(v) = row.try_get::<Vec<u8>, _>(index) {
    return Ok(Value::Object(Map::from_iter([
      ("type".into(), Value::String("Buffer".into())),
      ("hex".into(), Value::String(hex::encode(v))),
    ])));
  }
  Ok(Value::Null)
}
