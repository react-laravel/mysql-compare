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
  if let Some((schema, name)) = scoped_pg_table(table) {
    return format!("{}.{}", quote_pg_ident(&schema), quote_pg_ident(&name));
  }
  format!("{}.{}", quote_pg_ident(schema), quote_pg_ident(table))
}

pub fn scoped_pg_table(table: &str) -> Option<(String, String)> {
  let parts: (String, String) = serde_json::from_str(table.strip_prefix('\0')?).ok()?;
  if parts.0.is_empty() || parts.1.is_empty() || parts.0.contains('\0') || parts.1.contains('\0') { return None; }
  Some(parts)
}

pub fn pg_table_parts(table: &str) -> (String, String) {
  scoped_pg_table(table).unwrap_or_else(|| ("public".into(), table.into()))
}

pub fn pg_table_key(schema: &str, table: &str) -> String {
  if schema == "public" { table.into() } else { format!("\0{}", serde_json::to_string(&(schema, table)).unwrap()) }
}

pub fn pg_table_display_name(table: &str) -> String {
  match scoped_pg_table(table) {
    Some((schema, name)) if schema != "public" => format!("{schema}.{name}"),
    Some((_, name)) => name,
    None => table.into(),
  }
}

pub fn assert_pg_table(table: &str) -> Result<(), String> {
  let (schema, name) = pg_table_parts(table);
  if schema.is_empty() || name.is_empty() || schema.contains('\0') || name.contains('\0') {
    Err("Invalid PostgreSQL table reference".into())
  } else { Ok(()) }
}

/// WHERE is an advanced SQL expression, not a parameterized filter language.
/// This lexer prevents escaping that expression into another statement/clause;
/// quoted strings and legitimate nested subqueries remain supported.
pub fn assert_safe_where(where_sql: Option<&str>) -> Result<(), String> {
  let Some(w) = where_sql.map(str::trim).filter(|s| !s.is_empty()) else { return Ok(()); };
  if w.len() > 64 * 1024 || w.contains('\0') { return Err("Invalid WHERE expression".into()); }
  let chars: Vec<char> = w.chars().collect();
  let mut i = 0;
  let mut depth = 0usize;
  while i < chars.len() {
    let c = chars[i];
    if matches!(c, '\'' | '"' | '`') {
      let quote = c;
      i += 1;
      let mut closed = false;
      while i < chars.len() {
        if chars[i] == '\\' {
          if i + 1 < chars.len() && chars[i + 1] == quote { return Err("Use doubled quotes in WHERE literals instead of ambiguous backslash escapes".into()); }
          i += 2; continue;
        }
        if chars[i] == quote {
          i += 1;
          if i < chars.len() && chars[i] == quote { i += 1; continue; }
          closed = true;
          break;
        }
        i += 1;
      }
      if !closed { return Err("Unterminated quote in WHERE expression".into()); }
      continue;
    }
    if c == ';' || c == '#' || (i + 1 < chars.len() && ((c == '-' && chars[i + 1] == '-') || (c == '/' && chars[i + 1] == '*'))) {
      return Err("WHERE accepts one SQL expression without comments or statement separators".into());
    }
    if c == '(' { depth += 1; }
    if c == ')' { depth = depth.checked_sub(1).ok_or("Unbalanced parentheses in WHERE expression")?; }
    if c.is_ascii_alphabetic() || c == '_' {
      let begin = i;
      i += 1;
      while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_' || chars[i] == '$') { i += 1; }
      let word: String = chars[begin..i].iter().collect::<String>().to_ascii_uppercase();
      if word == "UNION" || (depth == 0 && matches!(word.as_str(), "ORDER" | "GROUP" | "LIMIT" | "OFFSET" | "RETURNING" | "INTO" | "FOR" | "SELECT" | "WITH")) {
        return Err("WHERE accepts a SQL expression; use the SQL editor for complete queries".into());
      }
      continue;
    }
    i += 1;
  }
  if depth != 0 { return Err("Unbalanced parentheses in WHERE expression".into()); }
  Ok(())
}

/// Validate a selected projection and keep the keys needed to edit/page rows.
pub fn browse_projection(schema: &crate::types::TableSchema, requested: Option<&[String]>, dialect: SqlDialect) -> Result<String, String> {
  let Some(requested) = requested else { return Ok("*".into()); };
  let mut names = Vec::new();
  for name in requested {
    if !schema.columns.iter().any(|column| column.name == *name) { return Err(format!("Unknown selected column: {name}")); }
    if !names.contains(name) { names.push(name.clone()); }
  }
  for name in &schema.primary_key { if !names.contains(name) { names.push(name.clone()); } }
  if names.is_empty() {
    names.push(schema.columns.first().ok_or("Table has no selectable columns")?.name.clone());
  }
  Ok(names.iter().map(|name| dialect.quote_ident(name)).collect::<Vec<_>>().join(", "))
}

/// Keyset pagination follows the default complete primary-key ASC order.
pub fn browse_cursor_filter(schema: &crate::types::TableSchema, request: &crate::types::QueryRowsRequest, dialect: SqlDialect) -> Result<Option<String>, String> {
  let Some(after) = request.after.as_ref() else { return Ok(None); };
  if request.order_by.is_some() || request.key_rows.is_some() || schema.primary_key.is_empty() {
    return Err("A pagination cursor requires the default primary-key order".into());
  }
  if after.len() != schema.primary_key.len() || schema.primary_key.iter().any(|name| after.get(name).map_or(true, serde_json::Value::is_null)) {
    return Err("A pagination cursor requires every non-null primary-key value".into());
  }
  let names = schema.primary_key.iter().map(|name| dialect.quote_ident(name)).collect::<Vec<_>>().join(", ");
  let values = schema.primary_key.iter().map(|name| dialect.literal(after.get(name))).collect::<Vec<_>>().join(", ");
  Ok(Some(format!("({names}) > ({values})")))
}

pub fn next_browse_cursor(schema: &crate::types::TableSchema, request: &crate::types::QueryRowsRequest, rows: &[std::collections::HashMap<String, serde_json::Value>], has_more: bool) -> Option<std::collections::HashMap<String, serde_json::Value>> {
  if !has_more || request.order_by.is_some() || request.key_rows.is_some() || schema.primary_key.is_empty() { return None; }
  let row = rows.last()?;
  let mut cursor = std::collections::HashMap::new();
  for name in &schema.primary_key {
    let value = row.get(name).filter(|value| !value.is_null())?;
    cursor.insert(name.clone(), value.clone());
  }
  Some(cursor)
}

pub fn browse_select_sql(table: &str, projection: &str, where_clause: &str, order_clause: &str, limit: u32, offset: u64, keyset: bool) -> String {
  let sql = format!("SELECT {projection} FROM {table} {where_clause} {order_clause} LIMIT {limit}");
  if keyset { sql } else { format!("{sql} OFFSET {offset}") }
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
  fn keyset_sql_omits_offset_and_projection_keeps_only_requested_fields_and_keys() {
    let schema: crate::types::TableSchema = serde_json::from_value(serde_json::json!({"name":"items","columns":[{"name":"id","type":"int","nullable":false,"isPrimaryKey":true,"isAutoIncrement":false,"comment":"","columnKey":"PRI"},{"name":"public","type":"text","nullable":true,"isPrimaryKey":false,"isAutoIncrement":false,"comment":"","columnKey":""},{"name":"private","type":"text","nullable":true,"isPrimaryKey":false,"isAutoIncrement":false,"comment":"","columnKey":""}],"indexes":[],"primaryKey":["id"],"createSQL":""})).unwrap();
    for dialect in [SqlDialect::Mysql, SqlDialect::Postgres] {
      let projection = browse_projection(&schema, Some(&["public".into()]), dialect).unwrap();
      assert!(projection.contains("public") && projection.contains("id") && !projection.contains("private"));
      let sql = browse_select_sql("items", &projection, "WHERE id > 5", "ORDER BY id ASC", 51, 100000, true);
      assert!(!sql.contains("OFFSET")); assert!(!sql.contains("SELECT *"));
      assert!(browse_select_sql("items", &projection, "", "", 51, 100000, false).contains("OFFSET 100000"));
    }
  }

  #[test]
  fn where_lexer_preserves_literals_but_rejects_statement_escape() {
    for expression in ["id = 1; SELECT 2", "id=1 # comment", "id=1 -- comment", "id=1 /*comment*/", "id=1 UNION SELECT 2", "id=1 ORDER BY id", "id='unfinished", "id IN (1,2", "id=1)"] { assert!(assert_safe_where(Some(expression)).is_err(), "{expression}"); }
    for expression in ["label = 'a;#--/* UNION'", "id IN (SELECT id FROM items WHERE label = 'ok')", "label='it''s ok'", "(id = 1 OR id=2)", "`odd#column` = 2"] { assert!(assert_safe_where(Some(expression)).is_ok(), "{expression}"); }
  }

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

  #[test]
  fn scoped_table_keys_quote_each_identifier_without_ambiguity() {
    let key = pg_table_key("sales.v2", "odd\".name");
    assert_eq!(quote_pg_table("public", &key), "\"sales.v2\".\"odd\"\".name\"");
    assert_eq!(pg_table_display_name(&key), "sales.v2.odd\".name");
    assert_eq!(pg_table_display_name("a.b"), "a.b");
    assert!(assert_pg_table(&key).is_ok());
    assert!(assert_pg_table("\0invalid").is_err());
    assert_eq!(quote_pg_table("public", "a.b"), "\"public\".\"a.b\"");
  }
}
