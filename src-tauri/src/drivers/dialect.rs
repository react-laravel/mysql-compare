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
