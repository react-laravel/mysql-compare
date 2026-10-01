use serde_json::{Map, Number, Value};
use sqlx::Column;
use sqlx::Row;
use sqlx::TypeInfo;
use sqlx::ValueRef;

pub fn json_from_mysql_row(
  row: &sqlx::mysql::MySqlRow,
) -> Result<std::collections::HashMap<String, Value>, String> {
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
      return Ok(integer_value(v as i128));
    }
    if let Ok(v) = row.try_get::<u64, _>(index) {
      return Ok(integer_value(v as i128));
    }
  }
  if type_name.contains("decimal") {
    return row
      .try_get_unchecked::<String, _>(index)
      .map(Value::String)
      .map_err(|e| e.to_string());
  }
  if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(index) {
    return Ok(Value::String(v.to_string()));
  }
  if let Ok(v) = row.try_get::<chrono::NaiveDate, _>(index) {
    return Ok(Value::String(v.to_string()));
  }
  if let Ok(v) = row.try_get::<chrono::NaiveTime, _>(index) {
    return Ok(Value::String(v.to_string()));
  }
  if let Ok(v) = row.try_get::<serde_json::Value, _>(index) {
    return Ok(v);
  }
  if type_name.contains("float") || type_name.contains("double") {
    if let Ok(v) = row.try_get::<f64, _>(index) {
      return Ok(
        Number::from_f64(v)
          .map(Value::Number)
          .unwrap_or_else(|| Value::String(v.to_string())),
      );
    }
  }
  if type_name == "tinyint" {
    if let Ok(v) = row.try_get::<i64, _>(index) {
      return Ok(integer_value(v as i128));
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
  Err(format!(
    "Cannot decode non-NULL column {} ({})",
    row.columns()[index].name(),
    raw.type_info().name()
  ))
}

pub fn json_from_pg_row(
  row: &sqlx::postgres::PgRow,
) -> Result<std::collections::HashMap<String, Value>, String> {
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
  let type_name = raw.type_info().name().to_uppercase();
  if type_name == "NUMERIC" {
    let text = match raw.format() {
      sqlx::postgres::PgValueFormat::Text => raw
        .as_str()
        .map(str::to_string)
        .map_err(|e| e.to_string())?,
      sqlx::postgres::PgValueFormat::Binary => {
        decode_pg_numeric(raw.as_bytes().map_err(|e| e.to_string())?)?
      }
    };
    return Ok(Value::String(text));
  }
  if let Ok(v) = row.try_get::<i16, _>(index) {
    return Ok(integer_value(v as i128));
  }
  if let Ok(v) = row.try_get::<i32, _>(index) {
    return Ok(integer_value(v as i128));
  }
  if let Ok(v) = row.try_get::<f32, _>(index) {
    return Ok(
      Number::from_f64(v as f64)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(v.to_string())),
    );
  }
  if let Ok(v) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(index) {
    return Ok(Value::String(v.to_rfc3339()));
  }
  if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(index) {
    return Ok(Value::String(v.to_string()));
  }
  if let Ok(v) = row.try_get::<chrono::NaiveDate, _>(index) {
    return Ok(Value::String(v.to_string()));
  }
  if let Ok(v) = row.try_get::<chrono::NaiveTime, _>(index) {
    return Ok(Value::String(v.to_string()));
  }
  if type_name == "UUID" {
    let value = match raw.format() {
      sqlx::postgres::PgValueFormat::Text => raw
        .as_str()
        .map(str::to_string)
        .map_err(|e| e.to_string())?,
      sqlx::postgres::PgValueFormat::Binary => {
        uuid::Uuid::from_slice(raw.as_bytes().map_err(|e| e.to_string())?)
          .map_err(|e| e.to_string())?
          .to_string()
      }
    };
    return Ok(Value::String(value));
  }
  if let Ok(v) = row.try_get::<i64, _>(index) {
    return Ok(integer_value(v as i128));
  }
  if let Ok(v) = row.try_get::<f64, _>(index) {
    return Ok(
      Number::from_f64(v)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(v.to_string())),
    );
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
  Err(format!(
    "Cannot decode non-NULL column {} ({})",
    row.columns()[index].name(),
    raw.type_info().name()
  ))
}


fn integer_value(value: i128) -> Value {
  const MAX_SAFE: i128 = 9_007_199_254_740_991;
  if (-MAX_SAFE..=MAX_SAFE).contains(&value) {
    Value::Number((value as i64).into())
  } else {
    Value::String(value.to_string())
  }
}

// PostgreSQL's binary NUMERIC consists of a base-10000 digit vector, weight,
// sign and decimal scale. Never round this representation through f64.
fn decode_pg_numeric(bytes: &[u8]) -> Result<String, String> {
  if bytes.len() < 8 {
    return Err("Invalid PostgreSQL NUMERIC header".into());
  }
  let word = |offset| u16::from_be_bytes([bytes[offset], bytes[offset + 1]]);
  let count = word(0) as usize;
  let weight = word(2) as i16 as i32;
  let sign = word(4);
  let scale = word(6) as usize;
  match sign {
    0xc000 => return Ok("NaN".into()),
    0xd000 => return Ok("Infinity".into()),
    0xf000 => return Ok("-Infinity".into()),
    0 | 0x4000 => {}
    _ => return Err("Invalid NUMERIC sign".into()),
  }
  if bytes.len() != 8 + count * 2 {
    return Err("Invalid NUMERIC digits".into());
  }
  let digits: Vec<_> = (0..count).map(|i| word(8 + i * 2)).collect();
  if digits.iter().any(|digit| *digit >= 10000) {
    return Err("Invalid NUMERIC digit".into());
  }
  let group = |power: i32| {
    let index = weight - power;
    if index >= 0 {
      digits.get(index as usize).copied().unwrap_or(0)
    } else {
      0
    }
  };
  let mut result = String::new();
  if sign == 0x4000 && digits.iter().any(|d| *d != 0) {
    result.push('-');
  }
  if weight < 0 {
    result.push('0');
  } else {
    result.push_str(&group(weight).to_string());
    for power in (0..weight).rev() {
      result.push_str(&format!("{:04}", group(power)));
    }
  }
  if scale > 0 {
    result.push('.');
    let mut fraction = String::new();
    for index in 1..=((scale + 3) / 4) {
      fraction.push_str(&format!("{:04}", group(-(index as i32))));
    }
    result.push_str(&fraction[..scale]);
  }
  Ok(result)
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn integers_cross_ipc_without_losing_precision() {
    assert_eq!(
      integer_value(9_007_199_254_740_991),
      serde_json::json!(9_007_199_254_740_991i64)
    );
    assert_eq!(
      integer_value(9_007_199_254_740_993),
      serde_json::json!("9007199254740993")
    );
    assert_eq!(
      integer_value(u64::MAX as i128),
      serde_json::json!(u64::MAX.to_string())
    );
  }
  #[test]
  fn numeric_decoding_preserves_scale_and_small_or_large_values() {
    fn number(weight: i16, scale: u16, digits: &[u16]) -> Vec<u8> {
      [
        vec![digits.len() as u16, weight as u16, 0, scale],
        digits.to_vec(),
      ]
      .concat()
      .iter()
      .flat_map(|v| v.to_be_bytes())
      .collect()
    }
    assert_eq!(
      decode_pg_numeric(&number(1, 6, &[12, 3456, 789, 100])).unwrap(),
      "123456.078901"
    );
    assert_eq!(
      decode_pg_numeric(&number(-2, 10, &[12, 3400])).unwrap(),
      "0.0000001234"
    );
    assert_eq!(
      decode_pg_numeric(&number(2, 2, &[90, 7199, 2547])).unwrap(),
      "9071992547.00"
    );
    assert!(decode_pg_numeric(&[0]).is_err());
  }
}
