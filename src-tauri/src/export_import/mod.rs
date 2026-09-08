use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::Arc;

use crate::drivers::dialect::{read_rows_sql, SqlDialect};
use crate::drivers::EngineDriver;
use crate::types::{
  ExportDatabaseRequest, ExportDatabaseResult, ExportTableRequest, ExportTableResult,
  ImportTableRequest, ImportTableResult, TableSchema,
};

struct ExportFile {
  path: PathBuf,
  target: PathBuf,
  writer: Option<BufWriter<std::fs::File>>,
}

impl ExportFile {
  fn new(target: &str) -> Result<Self, String> {
    let target = PathBuf::from(target);
    let path = target.with_file_name(format!(".mysql-compare-{}.part", uuid::Uuid::new_v4()));
    let file = std::fs::OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&path)
      .map_err(|e| e.to_string())?;
    Ok(Self {
      path,
      target,
      writer: Some(BufWriter::new(file)),
    })
  }
  fn finish(mut self) -> Result<(), String> {
    if let Some(mut writer) = self.writer.take() {
      writer.flush().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&self.path, &self.target).map_err(|e| e.to_string())
  }
}
impl Drop for ExportFile {
  fn drop(&mut self) {
    self.writer.take();
    let _ = std::fs::remove_file(&self.path);
  }
}

fn write_text(writer: &mut impl Write, text: &str) -> Result<(), String> {
  writer.write_all(text.as_bytes()).map_err(|e| e.to_string())
}

fn export_dialect(driver: SqlDialect, requested: Option<&str>) -> Result<SqlDialect, String> {
  match requested {
    None | Some("source") => Ok(driver),
    Some("mysql") => Ok(SqlDialect::Mysql),
    Some("postgres") | Some("postgresql") => Ok(SqlDialect::Postgres),
    _ => Err("Unsupported SQL export dialect".into()),
  }
}

fn export_query(
  req: &ExportTableRequest,
  schema: &TableSchema,
  dialect: SqlDialect,
) -> Result<Option<String>, String> {
  let (filter, range) = match req.scope.as_str() {
    "all" => (None, None),
    "filtered" => (req.where_sql.as_deref(), None),
    "page" => {
      let page = req
        .page
        .filter(|page| *page > 0)
        .ok_or("Export page is required")?;
      let size = req
        .page_size
        .filter(|size| (1..=1000).contains(size))
        .ok_or("Invalid export page size")?;
      (
        req.where_sql.as_deref(),
        Some((u64::from(page - 1) * u64::from(size), size)),
      )
    }
    "selected" => {
      if req.selected_rows.is_none() {
        return Err("Selected rows are required".into());
      }
      return Ok(None);
    }
    _ => return Err("Invalid export scope".into()),
  };
  if let Some(order) = &req.order_by {
    if !schema.columns.iter().any(|c| c.name == order.column) {
      return Err("Unknown export sort column".into());
    }
  }
  read_rows_sql(
    dialect,
    &req.database,
    &req.table,
    &schema.primary_key,
    filter,
    req.order_by.as_ref(),
    range,
  )
  .map(Some)
}

fn validate_create_sql(sql: &str) -> Result<(), String> {
  if sql.trim().is_empty() || sql.contains("-- reconstructed") {
    return Err("Complete CREATE SQL is unavailable for this table; export data only".into());
  }
  Ok(())
}

async fn write_table(
  driver: Arc<EngineDriver>,
  req: &ExportTableRequest,
  writer: &mut impl Write,
) -> Result<i64, String> {
  if !matches!(req.format.as_str(), "sql" | "csv" | "txt") {
    return Err("Unsupported export format".into());
  }
  let source_dialect = driver.dialect()?;
  let dialect = export_dialect(source_dialect, req.sql_dialect.as_deref())?;
  let schema = driver.get_table_schema(&req.database, &req.table).await?;
  let query = export_query(req, &schema, source_dialect)?;
  let include_create = req.format == "sql" && req.include_create_table.unwrap_or(true);
  if include_create {
    if dialect != source_dialect {
      return Err("Cross-engine CREATE SQL export is not supported; export data only".into());
    }
    validate_create_sql(&schema.create_sql)?;
    write_text(
      writer,
      &format!(
        "{};\n\n",
        schema.create_sql.trim_end().trim_end_matches(';')
      ),
    )?;
  }
  let columns: Vec<_> = schema
    .columns
    .iter()
    .filter(|c| !c.is_generated)
    .map(|c| c.name.clone())
    .collect();
  let separator = if req.format == "csv" { ',' } else { '\t' };
  if req.format != "sql" && req.include_headers.unwrap_or(true) {
    let header = columns
      .iter()
      .map(|c| escape_csv(Some(&serde_json::Value::String(c.clone())), separator))
      .collect::<Vec<_>>()
      .join(&separator.to_string());
    write_text(writer, &format!("{header}\n"))?;
  }
  if !req.include_data.unwrap_or(true) {
    return Ok(0);
  }
  let mut rows_exported = 0;
  if let Some(sql) = query {
    let mut batches = driver.read_batches(&req.database, sql, 200).await?;
    while let Some(rows) = batches.recv().await {
      let rows = rows?;
      write_export_rows(writer, req, &columns, &rows, dialect, separator)?;
      rows_exported += rows.len() as i64;
    }
  } else {
    for rows in req.selected_rows.as_deref().unwrap_or_default().chunks(200) {
      write_export_rows(writer, req, &columns, rows, dialect, separator)?;
      rows_exported += rows.len() as i64;
    }
  }
  Ok(rows_exported)
}

fn write_export_rows(
  writer: &mut impl Write,
  req: &ExportTableRequest,
  columns: &[String],
  rows: &[std::collections::HashMap<String, serde_json::Value>],
  dialect: SqlDialect,
  separator: char,
) -> Result<(), String> {
  if req.format == "sql" {
    if rows.is_empty() || columns.is_empty() {
      return Ok(());
    }
    let cols = columns
      .iter()
      .map(|c| dialect.quote_ident(c))
      .collect::<Vec<_>>()
      .join(", ");
    write_text(
      writer,
      &format!(
        "INSERT INTO {} ({cols}){} VALUES\n",
        dialect.quote_ident(&req.table),
        if dialect == SqlDialect::Postgres {
          " OVERRIDING SYSTEM VALUE"
        } else {
          ""
        }
      ),
    )?;
    for (index, row) in rows.iter().enumerate() {
      let values = columns
        .iter()
        .map(|c| dialect.literal(row.get(c)))
        .collect::<Vec<_>>()
        .join(", ");
      write_text(
        writer,
        &format!(
          "  ({values}){}\n",
          if index + 1 == rows.len() { ";" } else { "," }
        ),
      )?;
    }
  } else {
    for row in rows {
      let values = columns
        .iter()
        .map(|c| escape_csv(row.get(c), separator))
        .collect::<Vec<_>>()
        .join(&separator.to_string());
      write_text(writer, &format!("{values}\n"))?;
    }
  }
  Ok(())
}

pub async fn export_table(
  driver: Arc<EngineDriver>,
  req: &ExportTableRequest,
  file_path: &str,
) -> Result<ExportTableResult, String> {
  let mut file = ExportFile::new(file_path)?;
  let rows = write_table(driver, req, file.writer.as_mut().unwrap()).await?;
  file.finish()?;
  Ok(ExportTableResult {
    canceled: false,
    file_path: Some(file_path.into()),
    rows_exported: rows,
  })
}

pub async fn export_database(
  driver: Arc<EngineDriver>,
  req: &ExportDatabaseRequest,
  file_path: &str,
  conn_host: &str,
  conn_port: u16,
  conn_user: &str,
  conn_password: &str,
) -> Result<ExportDatabaseResult, String> {
  let backend = req.backend.as_deref().unwrap_or("builtin");
  if backend == "mysqldump" || backend == "mysqldump-ssh" {
    if driver.dialect()? != SqlDialect::Mysql
      || export_dialect(SqlDialect::Mysql, req.sql_dialect.as_deref())? != SqlDialect::Mysql
    {
      return Err("mysqldump requires MySQL input and output".into());
    }
    let req = req.clone();
    let host = conn_host.to_string();
    let user = conn_user.to_string();
    let password = conn_password.to_string();
    let destination = file_path.to_string();
    let backend = backend.to_string();
    return tokio::task::spawn_blocking(move || {
      let file = ExportFile::new(&destination)?;
      let output_file = file
        .writer
        .as_ref()
        .unwrap()
        .get_ref()
        .try_clone()
        .map_err(|e| e.to_string())?;
      let mut cmd = std::process::Command::new("mysqldump");
      cmd
        .arg("-h")
        .arg(host)
        .arg("-P")
        .arg(conn_port.to_string())
        .arg("-u")
        .arg(user)
        .arg("--single-transaction")
        .arg("--hex-blob")
        .arg("--complete-insert");
      if !req.include_data.unwrap_or(true) {
        cmd.arg("--no-data");
      }
      if !req.include_create_table.unwrap_or(true) {
        cmd.arg("--no-create-info");
      }
      cmd
        .arg("--")
        .arg(&req.database)
        .stdout(output_file)
        .stderr(std::process::Stdio::piped());
      if !password.is_empty() {
        cmd.env("MYSQL_PWD", password);
      }
      let output = cmd.output().map_err(|e| e.to_string())?;
      if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
      }
      file.finish()?;
      Ok(ExportDatabaseResult {
        canceled: false,
        file_path: Some(destination),
        tables_exported: 0,
        rows_exported: 0,
        backend: Some(backend),
        rows_count_accurate: Some(false),
      })
    })
    .await
    .map_err(|e| e.to_string())?;
  }
  if backend != "builtin" {
    return Err("Unsupported export backend".into());
  }
  let tables = driver.list_tables(&req.database).await?;
  let mut file = ExportFile::new(file_path)?;
  let mut total_rows = 0;
  for table in &tables {
    total_rows += write_table(
      driver.clone(),
      &ExportTableRequest {
        connection_id: req.connection_id.clone(),
        database: req.database.clone(),
        table: table.clone(),
        format: "sql".into(),
        sql_dialect: req.sql_dialect.clone(),
        scope: "all".into(),
        where_sql: None,
        order_by: None,
        page: None,
        page_size: None,
        selected_rows: None,
        include_create_table: req.include_create_table,
        include_data: req.include_data,
        include_headers: None,
      },
      file.writer.as_mut().unwrap(),
    )
    .await?;
  }
  file.finish()?;
  Ok(ExportDatabaseResult {
    canceled: false,
    file_path: Some(file_path.into()),
    tables_exported: tables.len() as i64,
    rows_exported: total_rows,
    backend: Some("builtin".into()),
    rows_count_accurate: Some(true),
  })
}

pub async fn import_table(
  driver: Arc<EngineDriver>,
  req: &ImportTableRequest,
  file_path: Option<&str>,
) -> Result<ImportTableResult, String> {
  let content = if let Some(c) = &req.file_content {
    c.clone()
  } else if let Some(path) = file_path.or(req.file_name.as_deref()) {
    std::fs::read_to_string(path).map_err(|e| e.to_string())?
  } else {
    return Ok(ImportTableResult {
      canceled: true,
      file_path: None,
      rows_imported: 0,
      statements_executed: 0,
    });
  };

  if req.format == "sql" {
    driver.execute_sql(&content, Some(&req.database)).await?;
    let statements = content.matches(';').count() as i64;
    return Ok(ImportTableResult {
      canceled: false,
      file_path: file_path.map(str::to_string),
      rows_imported: 0,
      statements_executed: statements,
    });
  }

  let sep = if req.format == "csv" { ',' } else { '\t' };
  let schema = driver.get_table_schema(&req.database, &req.table).await?;
  let lines = parse_records(&content, sep)?;
  if lines.is_empty() {
    return Ok(ImportTableResult {
      canceled: false,
      file_path: file_path.map(str::to_string),
      rows_imported: 0,
      statements_executed: 0,
    });
  }

  let include_headers = req.include_headers.unwrap_or(true);
  let empty_as_null = req.empty_as_null.unwrap_or(true);
  let (header, data_lines) = if include_headers {
    (lines[0].clone(), &lines[1..])
  } else {
    (
      schema
        .columns
        .iter()
        .filter(|c| !c.is_generated)
        .map(|c| c.name.clone())
        .collect(),
      &lines[..],
    )
  };

  if header.is_empty()
    || header
      .iter()
      .collect::<std::collections::HashSet<_>>()
      .len()
      != header.len()
    || header
      .iter()
      .any(|name| !schema.columns.iter().any(|column| column.name == *name))
  {
    return Err("Invalid or duplicate import column name".into());
  }
  for (index, values) in data_lines.iter().enumerate() {
    if values.len() != header.len() {
      return Err(format!(
        "Column count mismatch at record {}",
        index + 1 + usize::from(include_headers)
      ));
    }
  }
  let mut imported = 0i64;
  for (idx, line) in data_lines.iter().enumerate() {
    let values = line.clone();
    if values.len() != header.len() {
      return Err(format!(
        "Column count mismatch at line {}",
        idx + if include_headers { 2 } else { 1 }
      ));
    }
    let mut map = std::collections::HashMap::new();
    for (col, val) in header.iter().zip(values.into_iter()) {
      let json_val = if empty_as_null && val.is_empty() {
        serde_json::Value::Null
      } else {
        serde_json::Value::String(val)
      };
      map.insert(col.clone(), json_val);
    }
    driver
      .insert_row(&crate::types::InsertRowRequest {
        connection_id: req.connection_id.clone(),
        database: req.database.clone(),
        table: req.table.clone(),
        values: map,
      })
      .await?;
    imported += 1;
  }

  Ok(ImportTableResult {
    canceled: false,
    file_path: file_path.map(str::to_string),
    rows_imported: imported,
    statements_executed: 0,
  })
}

fn parse_records(content: &str, sep: char) -> Result<Vec<Vec<String>>, String> {
  let mut records = Vec::new();
  let mut record = Vec::new();
  let mut field = String::new();
  let mut in_quotes = false;
  let mut closed_quote = false;
  let mut started = false;
  let mut chars = content.trim_start_matches('\u{feff}').chars().peekable();
  while let Some(ch) = chars.next() {
    if in_quotes {
      if ch == '"' {
        if chars.peek() == Some(&'"') {
          field.push('"');
          chars.next();
        } else {
          in_quotes = false;
          closed_quote = true;
        }
      } else {
        field.push(ch);
      }
      continue;
    }
    if closed_quote && ch != sep && ch != '\n' && ch != '\r' {
      return Err("Unexpected text after a quoted CSV field".into());
    }
    if ch == sep {
      record.push(std::mem::take(&mut field));
      closed_quote = false;
      started = true;
    } else if ch == '\n' || ch == '\r' {
      if ch == '\r' && chars.peek() == Some(&'\n') {
        chars.next();
      }
      if started || !field.is_empty() || !record.is_empty() {
        record.push(std::mem::take(&mut field));
        records.push(std::mem::take(&mut record));
      }
      closed_quote = false;
      started = false;
    } else if ch == '"' {
      if !field.is_empty() {
        return Err("Unexpected quote in CSV field".into());
      }
      in_quotes = true;
      started = true;
    } else {
      field.push(ch);
      started = true;
    }
  }
  if in_quotes {
    return Err("Unterminated quoted CSV field".into());
  }
  if started || !field.is_empty() || !record.is_empty() {
    record.push(field);
    records.push(record);
  }
  Ok(records)
}

fn escape_csv(value: Option<&serde_json::Value>, sep: char) -> String {
  let raw = match value {
    None | Some(serde_json::Value::Null) => String::new(),
    Some(serde_json::Value::String(s)) => s.clone(),
    Some(v) => v.to_string(),
  };
  if raw.contains(sep) || raw.contains('"') || raw.contains('\n') || raw.contains('\r') {
    format!("\"{}\"", raw.replace('"', "\"\""))
  } else {
    raw
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn csv_round_trips_quotes_newlines_crlf_and_empty_fields() {
    let values = [
      "line1\nline2",
      "comma,quote\"",
      "carriage\rreturn",
      "",
      " spaced ",
    ];
    let line = values
      .iter()
      .map(|value| escape_csv(Some(&json!(value)), ','))
      .collect::<Vec<_>>()
      .join(",");
    assert_eq!(
      parse_records(&format!("\u{feff}{line}\r\n"), ',').unwrap(),
      vec![values]
    );
    assert_eq!(parse_records("\"\"\n", ',').unwrap(), vec![vec![""]]);
    assert!(parse_records("a,\"unterminated", ',').is_err());
    assert!(parse_records("\"a\"invalid,b", ',').is_err());
  }

  #[test]
  fn a_failed_export_leaves_the_previous_file_intact_and_removes_temp_output() {
    let directory = std::env::temp_dir().join(format!(
      "mysql-compare-export-test-{}",
      uuid::Uuid::new_v4()
    ));
    std::fs::create_dir(&directory).unwrap();
    let target = directory.join("out.sql");
    std::fs::write(&target, "previous").unwrap();
    {
      let mut pending = ExportFile::new(target.to_str().unwrap()).unwrap();
      write_text(pending.writer.as_mut().unwrap(), "incomplete").unwrap();
    }
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "previous");
    assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
    std::fs::remove_dir_all(directory).unwrap();
  }
}
