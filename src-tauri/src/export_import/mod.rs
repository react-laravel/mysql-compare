use std::sync::Arc;

use crate::drivers::dialect::quote_mysql_ident;
use crate::drivers::EngineDriver;
use crate::types::{
  ExportDatabaseRequest, ExportDatabaseResult, ExportTableRequest, ExportTableResult,
  ImportTableRequest, ImportTableResult,
};

pub async fn export_table(
  driver: Arc<EngineDriver>,
  req: &ExportTableRequest,
  file_path: &str,
) -> Result<ExportTableResult, String> {
  let schema = driver
    .get_table_schema(&req.database, &req.table)
    .await?;
  let rows = if let Some(selected) = &req.selected_rows {
    selected.clone()
  } else {
    driver
      .stream_rows_ordered(
        &req.database,
        &req.table,
        &schema.primary_key,
        1000,
      )
      .await?
  };

  let include_create = req.include_create_table.unwrap_or(req.format == "sql");
  let include_data = req.include_data.unwrap_or(true);
  let include_headers = req.include_headers.unwrap_or(true);

  let mut out = String::new();
  match req.format.as_str() {
    "csv" | "txt" => {
      let sep = if req.format == "csv" { ',' } else { '\t' };
      let cols: Vec<_> = schema.columns.iter().map(|c| c.name.clone()).collect();
      if include_headers {
        out.push_str(&cols.join(&sep.to_string()));
        out.push('\n');
      }
      if include_data {
        for row in &rows {
          let line = cols
            .iter()
            .map(|c| escape_csv(row.get(c), sep))
            .collect::<Vec<_>>()
            .join(&sep.to_string());
          out.push_str(&line);
          out.push('\n');
        }
      }
    }
    _ => {
      if include_create && !schema.create_sql.is_empty() {
        out.push_str(&schema.create_sql);
        out.push_str(";\n\n");
      }
      if include_data && !rows.is_empty() {
        let cols: Vec<_> = schema.columns.iter().map(|c| c.name.clone()).collect();
        let col_sql = cols
          .iter()
          .map(|c| quote_mysql_ident(c))
          .collect::<Vec<_>>()
          .join(", ");
        for chunk in rows.chunks(200) {
          out.push_str(&format!(
            "INSERT INTO {} ({col_sql}) VALUES\n",
            quote_mysql_ident(&req.table)
          ));
          let values = chunk
            .iter()
            .map(|row| {
              let vals = cols
                .iter()
                .map(|c| sql_literal(row.get(c)))
                .collect::<Vec<_>>()
                .join(", ");
              format!("  ({vals})")
            })
            .collect::<Vec<_>>()
            .join(",\n");
          out.push_str(&values);
          out.push_str(";\n");
        }
      }
    }
  }

  std::fs::write(file_path, out).map_err(|e| e.to_string())?;
  Ok(ExportTableResult {
    canceled: false,
    file_path: Some(file_path.to_string()),
    rows_exported: rows.len() as i64,
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
    let mut cmd = std::process::Command::new("mysqldump");
    cmd.arg("-h")
      .arg(conn_host)
      .arg("-P")
      .arg(conn_port.to_string())
      .arg("-u")
      .arg(conn_user)
      .arg("--single-transaction")
      .arg("--hex-blob")
      .arg("--complete-insert")
      .arg(&req.database);
    if !conn_password.is_empty() {
      cmd.env("MYSQL_PWD", conn_password);
    }
    let output = cmd.output().map_err(|e| {
      if e.kind() == std::io::ErrorKind::NotFound {
        "mysqldump not found on PATH".into()
      } else {
        e.to_string()
      }
    })?;
    if !output.status.success() {
      return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    std::fs::write(file_path, &output.stdout).map_err(|e| e.to_string())?;
    return Ok(ExportDatabaseResult {
      canceled: false,
      file_path: Some(file_path.to_string()),
      tables_exported: 0,
      rows_exported: 0,
      backend: Some(backend.into()),
      rows_count_accurate: Some(false),
    });
  }

  let tables = driver.list_tables(&req.database).await?;
  let mut total_rows = 0i64;
  let mut out = String::new();
  out.push_str(&format!("-- Database: {}\n\n", req.database));
  for table in &tables {
    let result = export_table(
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
        include_create_table: req.include_create_table.or(Some(true)),
        include_data: req.include_data.or(Some(true)),
        include_headers: None,
      },
      &format!("{file_path}.{table}.part"),
    )
    .await?;
    if let Some(part_path) = result.file_path {
      let part = std::fs::read_to_string(&part_path).unwrap_or_default();
      out.push_str(&part);
      out.push('\n');
      let _ = std::fs::remove_file(part_path);
    }
    total_rows += result.rows_exported;
  }
  std::fs::write(file_path, out).map_err(|e| e.to_string())?;
  Ok(ExportDatabaseResult {
    canceled: false,
    file_path: Some(file_path.to_string()),
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
    driver
      .execute_sql(&content, Some(&req.database))
      .await?;
    let statements = content.matches(';').count() as i64;
    return Ok(ImportTableResult {
      canceled: false,
      file_path: file_path.map(str::to_string),
      rows_imported: 0,
      statements_executed: statements,
    });
  }

  let sep = if req.format == "csv" { ',' } else { '\t' };
  let schema = driver
    .get_table_schema(&req.database, &req.table)
    .await?;
  let lines: Vec<&str> = content.lines().collect();
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
    (parse_line(lines[0], sep), &lines[1..])
  } else {
    (
      schema.columns.iter().map(|c| c.name.clone()).collect(),
      &lines[..],
    )
  };

  let mut imported = 0i64;
  for (idx, line) in data_lines.iter().enumerate() {
    if line.trim().is_empty() {
      continue;
    }
    let values = parse_line(line, sep);
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

fn parse_line(line: &str, sep: char) -> Vec<String> {
  let mut out = Vec::new();
  let mut cur = String::new();
  let mut in_quotes = false;
  let mut chars = line.chars().peekable();
  while let Some(ch) = chars.next() {
    if in_quotes {
      if ch == '"' {
        if chars.peek() == Some(&'"') {
          cur.push('"');
          chars.next();
        } else {
          in_quotes = false;
        }
      } else {
        cur.push(ch);
      }
    } else if ch == '"' {
      in_quotes = true;
    } else if ch == sep {
      out.push(std::mem::take(&mut cur));
    } else if ch != '\r' {
      cur.push(ch);
    }
  }
  out.push(cur);
  out
}

fn escape_csv(value: Option<&serde_json::Value>, sep: char) -> String {
  let raw = match value {
    None | Some(serde_json::Value::Null) => String::new(),
    Some(serde_json::Value::String(s)) => s.clone(),
    Some(v) => v.to_string(),
  };
  if raw.contains(sep) || raw.contains('"') || raw.contains('\n') {
    format!("\"{}\"", raw.replace('"', "\"\""))
  } else {
    raw
  }
}

fn sql_literal(value: Option<&serde_json::Value>) -> String {
  match value {
    None | Some(serde_json::Value::Null) => "NULL".into(),
    Some(serde_json::Value::Bool(b)) => if *b { "1" } else { "0" }.into(),
    Some(serde_json::Value::Number(n)) => n.to_string(),
    Some(serde_json::Value::String(s)) => {
      format!("'{}'", s.replace('\\', "\\\\").replace('\'', "''"))
    }
    Some(v) => format!("'{}'", v.to_string().replace('\'', "''")),
  }
}
