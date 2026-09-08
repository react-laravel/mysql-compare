pub fn quote_mysql_ident(name: &str) -> String {
  format!("`{}`", name.replace('`', "``"))
}

pub fn quote_mysql_table(database: &str, table: &str) -> String {
  format!(
    "{}.{}",
    quote_mysql_ident(database),
    quote_mysql_ident(table)
  )
}

pub fn quote_pg_ident(name: &str) -> String {
  format!("\"{}\"", name.replace('"', "\"\""))
}

pub fn quote_pg_table(schema: &str, table: &str) -> String {
  format!("{}.{}", quote_pg_ident(schema), quote_pg_ident(table))
}

pub fn assert_safe_where(where_sql: Option<&str>) -> Result<(), String> {
  let Some(w) = where_sql.map(str::trim).filter(|s| !s.is_empty()) else {
    return Ok(());
  };
  let lower = w.to_lowercase();
  if w.contains(';') || lower.contains("--") || lower.contains("/*") {
    return Err("Unsafe WHERE clause rejected".into());
  }
  Ok(())
}

pub fn assert_ident(name: &str, label: &str) -> Result<(), String> {
  if name.trim().is_empty() {
    return Err(format!("{label} is required"));
  }
  if !name
    .chars()
    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
  {
    // Allow richer MySQL names via quoting path; still block obvious injection separators
    if name.contains(';') || name.contains('`') || name.contains('"') {
      return Err(format!("Invalid {label}"));
    }
  }
  Ok(())
}

pub fn clamp_page_size(page_size: u32) -> u32 {
  page_size.clamp(1, 1000)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SqlDialect {
  Mysql,
  Postgres,
}

impl SqlDialect {
  pub fn quote_ident(self, name: &str) -> String {
    match self {
      Self::Mysql => quote_mysql_ident(name),
      Self::Postgres => quote_pg_ident(name),
    }
  }

  pub fn literal(self, value: Option<&serde_json::Value>) -> String {
    use serde_json::Value;
    match value {
      None | Some(Value::Null) => "NULL".into(),
      Some(Value::Bool(value)) => match self {
        Self::Mysql => {
          if *value {
            "1"
          } else {
            "0"
          }
        }
        Self::Postgres => {
          if *value {
            "TRUE"
          } else {
            "FALSE"
          }
        }
      }
      .into(),
      Some(Value::Number(value)) => value.to_string(),
      Some(Value::Object(value))
        if value.get("type").and_then(Value::as_str) == Some("Buffer")
          && value
            .get("hex")
            .and_then(Value::as_str)
            .is_some_and(|s| s.len() % 2 == 0 && s.bytes().all(|b| b.is_ascii_hexdigit())) =>
      {
        let hex = value["hex"].as_str().unwrap();
        match self {
          Self::Mysql => format!("X'{hex}'"),
          Self::Postgres => format!("decode('{hex}', 'hex')"),
        }
      }
      Some(value) => {
        let text = match value {
          Value::String(s) => s.clone(),
          v => v.to_string(),
        };
        match self {
          // Independent of NO_BACKSLASH_ESCAPES and the server's SQL mode.
          Self::Mysql => format!("CONVERT(X'{}' USING utf8mb4)", hex::encode(text.as_bytes())),
          Self::Postgres => format!("E'{}'", text.replace('\\', "\\\\").replace('\'', "''")),
        }
      }
    }
  }
}

pub fn key_rows_filter(
  keys: &[std::collections::HashMap<String, serde_json::Value>],
  primary_key: &[String],
  dialect: SqlDialect,
) -> Result<String, String> {
  if primary_key.is_empty() || keys.len() > 1000 {
    return Err("Key lookup requires a complete primary key and at most 1000 keys".into());
  }
  if keys.is_empty() {
    return Ok("1 = 0".into());
  }
  let mut predicates = Vec::new();
  for key in keys {
    if key.len() != primary_key.len()
      || primary_key
        .iter()
        .any(|c| key.get(c).map_or(true, serde_json::Value::is_null))
    {
      return Err("Key lookup requires every primary-key column".into());
    }
    predicates.push(format!(
      "({})",
      primary_key
        .iter()
        .map(|c| {
          format!(
            "{} = {}",
            dialect.quote_ident(c),
            dialect.literal(key.get(c))
          )
        })
        .collect::<Vec<_>>()
        .join(" AND ")
    ));
  }
  Ok(predicates.join(" OR "))
}

pub fn read_rows_sql(
  dialect: SqlDialect,
  database: &str,
  table: &str,
  keys: &[String],
  where_sql: Option<&str>,
  order_by: Option<&crate::types::OrderBy>,
  range: Option<(u64, u32)>,
) -> Result<String, String> {
  assert_safe_where(where_sql)?;
  let table = match dialect {
    SqlDialect::Mysql => quote_mysql_table(database, table),
    SqlDialect::Postgres => quote_pg_table("public", table),
  };
  let mut sql = format!("SELECT * FROM {table}");
  if let Some(where_sql) = where_sql.filter(|s| !s.trim().is_empty()) {
    sql.push_str(&format!(" WHERE {where_sql}"));
  }
  let mut order = Vec::new();
  if let Some(order_by) = order_by {
    if !matches!(order_by.dir.as_str(), "ASC" | "DESC") {
      return Err("Invalid sort direction".into());
    }
    order.push(format!(
      "{} {}",
      dialect.quote_ident(&order_by.column),
      order_by.dir
    ));
  }
  for key in keys {
    if order_by.map_or(true, |order| order.column != *key) {
      order.push(format!("{} ASC", dialect.quote_ident(key)));
    }
  }
  if !order.is_empty() {
    sql.push_str(&format!(" ORDER BY {}", order.join(", ")));
  }
  if let Some((offset, limit)) = range {
    sql.push_str(&format!(" LIMIT {limit} OFFSET {offset}"));
  }
  Ok(sql)
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn values_keep_dialect_and_binary_semantics() {
    assert_eq!(SqlDialect::Postgres.literal(Some(&json!(true))), "TRUE");
    assert_eq!(
      SqlDialect::Postgres.literal(Some(&json!("a\\b'c"))),
      "E'a\\\\b''c'"
    );
    assert_eq!(
      SqlDialect::Mysql.literal(Some(&json!("a'\\"))),
      "CONVERT(X'61275c' USING utf8mb4)"
    );
    let binary = json!({"type":"Buffer", "hex":"00ff"});
    assert_eq!(SqlDialect::Mysql.literal(Some(&binary)), "X'00ff'");
    assert_eq!(
      SqlDialect::Postgres.literal(Some(&binary)),
      "decode('00ff', 'hex')"
    );
  }

  #[test]
  fn composite_lookup_refuses_partial_keys() {
    let key = serde_json::from_value(json!({"id": 1})).unwrap();
    assert!(key_rows_filter(&[key], &["tenant".into(), "id".into()], SqlDialect::Mysql).is_err());
  }
}
