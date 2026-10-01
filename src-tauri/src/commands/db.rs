use tauri::{AppHandle, State};

use crate::ipc::IpcResult;
use crate::state::AppState;
use crate::types::{
  CopyTableRequest, DatabaseInfo, DeleteRowsRequest, DropDatabaseRequest, DropTableRequest,
  ExplainSQLRequest, ExplainSQLResult, ExportDatabaseRequest, ExportDatabaseResult,
  ExportTableRequest, ExportTableResult, ImportTableRequest, ImportTableResult, InsertRowRequest,
  QueryRowsRequest, QueryRowsResult, RenameTableRequest, TruncateTableRequest, UpdateRowRequest,
};

#[tauri::command]
pub async fn db_list_databases(
  app: AppHandle,
  state: State<'_, AppState>,
  connection_id: String,
) -> Result<IpcResult<Vec<String>>, String> {
  match state.get_driver(&app, &connection_id).await {
    Ok(d) => match d.list_databases().await {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(state.connection_error(&connection_id, e))),
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&connection_id, e))),
  }
}

#[tauri::command]
pub async fn db_get_database_info(
  app: AppHandle,
  state: State<'_, AppState>,
  connection_id: String,
  database: String,
) -> Result<IpcResult<DatabaseInfo>, String> {
  match state.get_driver(&app, &connection_id).await {
    Ok(d) => match d.get_database_info(&database).await {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(state.connection_error(&connection_id, e))),
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&connection_id, e))),
  }
}

#[tauri::command]
pub async fn db_list_tables(
  app: AppHandle,
  state: State<'_, AppState>,
  connection_id: String,
  database: String,
  schema: Option<String>,
) -> Result<IpcResult<Vec<String>>, String> {
  match state.get_driver(&app, &connection_id).await {
    Ok(d) => match d.list_tables_in_schema(&database, schema.as_deref()).await {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(state.connection_error(&connection_id, e))),
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&connection_id, e))),
  }
}

#[tauri::command]
pub async fn db_discover_databases(app: AppHandle, state: State<'_, AppState>, connection_id: String) -> Result<IpcResult<Vec<String>>, String> {
  Ok(match state.get_driver(&app, &connection_id).await {
    Ok(driver) => crate::ipc::map_result(driver.discover_databases().await),
    Err(error) => IpcResult::err(error),
  })
}

#[tauri::command]
pub async fn db_list_schemas(app: AppHandle, state: State<'_, AppState>, connection_id: String, database: String) -> Result<IpcResult<Vec<String>>, String> {
  Ok(match state.get_driver(&app, &connection_id).await {
    Ok(driver) => crate::ipc::map_result(driver.list_schemas(&database).await),
    Err(error) => IpcResult::err(error),
  })
}

#[tauri::command]
pub async fn db_query_rows(
  app: AppHandle,
  state: State<'_, AppState>,
  req: QueryRowsRequest,
  operation_id: Option<String>,
) -> Result<IpcResult<QueryRowsResult>, String> {
  let result = state.operations.run(operation_id.as_deref(), async {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => match d.query_rows(&req).await {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
  }

  }).await;
  Ok(result.unwrap_or_else(IpcResult::err))
}

#[tauri::command]
pub async fn db_insert_row(
  app: AppHandle,
  state: State<'_, AppState>,
  req: InsertRowRequest,
) -> Result<IpcResult<serde_json::Value>, String> {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => match d.insert_row(&req).await {
      Ok(()) => Ok(IpcResult::ok(serde_json::json!({ "affectedRows": 1 }))),
      Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
  }
}

#[tauri::command]
pub async fn db_update_row(
  app: AppHandle,
  state: State<'_, AppState>,
  req: UpdateRowRequest,
) -> Result<IpcResult<serde_json::Value>, String> {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => match d.update_row(&req).await {
      Ok(()) => Ok(IpcResult::ok(serde_json::json!({ "affectedRows": 1 }))),
      Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
  }
}

#[tauri::command]
pub async fn db_delete_rows(
  app: AppHandle,
  state: State<'_, AppState>,
  req: DeleteRowsRequest,
) -> Result<IpcResult<serde_json::Value>, String> {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => match d.delete_rows(&req).await {
      Ok(()) => Ok(IpcResult::ok(serde_json::json!({ "affectedRows": req.pk_rows.len() }))),
      Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
  }
}

#[tauri::command]
pub async fn db_execute_sql(
  app: AppHandle,
  state: State<'_, AppState>,
  connection_id: String,
  sql: String,
  database: Option<String>,
  operation_id: Option<String>,
) -> Result<IpcResult<serde_json::Value>, String> {
  let result = state.operations.run(operation_id.as_deref(), async {
  match state.get_driver(&app, &connection_id).await {
    Ok(d) => match d.execute_sql(&sql, database.as_deref()).await {
      Ok(result) => Ok(IpcResult::ok(result)),
      Err(e) => Ok(IpcResult::err(state.connection_error(&connection_id, e))),
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&connection_id, e))),
  }

  }).await;
  Ok(result.unwrap_or_else(IpcResult::err))
}

#[tauri::command]
pub async fn db_explain_sql(
  app: AppHandle,
  state: State<'_, AppState>,
  req: ExplainSQLRequest,
  operation_id: Option<String>,
) -> Result<IpcResult<ExplainSQLResult>, String> {
  let result = state.operations.run(operation_id.as_deref(), async {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => match d.explain_sql(&req.sql, req.database.as_deref()).await {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
  }

  }).await;
  Ok(result.unwrap_or_else(IpcResult::err))
}

#[tauri::command]
pub async fn db_rename_table(
  app: AppHandle,
  state: State<'_, AppState>,
  req: RenameTableRequest,
) -> Result<IpcResult<serde_json::Value>, String> {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => match d.rename_table(&req).await {
      Ok(table) => Ok(IpcResult::ok(serde_json::json!({ "table": table }))),
      Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
  }
}

#[tauri::command]
pub async fn db_copy_table(
  app: AppHandle,
  state: State<'_, AppState>,
  req: CopyTableRequest,
) -> Result<IpcResult<serde_json::Value>, String> {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => match d.copy_table(&req).await {
      Ok(table) => Ok(IpcResult::ok(serde_json::json!({ "table": table }))),
      Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
  }
}

#[tauri::command]
pub async fn db_drop_database(
  app: AppHandle,
  state: State<'_, AppState>,
  req: DropDatabaseRequest,
) -> Result<IpcResult<()>, String> {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => match d.drop_database(&req).await {
      Ok(()) => Ok(IpcResult::ok_empty()),
      Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
  }
}

#[tauri::command]
pub async fn db_drop_table(
  app: AppHandle,
  state: State<'_, AppState>,
  req: DropTableRequest,
) -> Result<IpcResult<()>, String> {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => match d.drop_table(&req).await {
      Ok(()) => Ok(IpcResult::ok_empty()),
      Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
  }
}

#[tauri::command]
pub async fn db_truncate_table(
  app: AppHandle,
  state: State<'_, AppState>,
  req: TruncateTableRequest,
) -> Result<IpcResult<()>, String> {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => match d.truncate_table(&req).await {
      Ok(()) => Ok(IpcResult::ok_empty()),
      Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
  }
}

#[tauri::command]
pub async fn db_export_table(
  app: AppHandle,
  state: State<'_, AppState>,
  req: ExportTableRequest,
  file_path: String,
  file_grant: Option<String>,
  operation_id: Option<String>,
) -> Result<IpcResult<ExportTableResult>, String> {
  let result = state.operations.run(operation_id.as_deref(), async {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => {
      let file_path = match state.file_grants.consume(file_grant.as_deref(), "export_table", &file_path) { Ok(path) => path.to_str().ok_or("Invalid local path encoding")?.to_string(), Err(e) => return Ok(IpcResult::err(e)) };
      match crate::export_import::export_table(d, &req, &file_path).await {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
      }
    },
    Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
  }

  }).await;
  Ok(result.unwrap_or_else(IpcResult::err))
}

#[tauri::command]
pub async fn db_export_database(
  app: AppHandle,
  state: State<'_, AppState>,
  req: ExportDatabaseRequest,
  file_path: String,
  file_grant: Option<String>,
  operation_id: Option<String>,
) -> Result<IpcResult<ExportDatabaseResult>, String> {
  let result = state.operations.run(operation_id.as_deref(), async {
  let conn = match state.connections.get_full(&app, &req.connection_id) {
    Ok(Some(c)) => c,
    Ok(None) => return Ok(IpcResult::err("Connection not found")),
    Err(e) => return Ok(IpcResult::err(e)),
  };
  let (host, port) = if conn.use_ssh {
    match state.ensure_tunnel(&app, &conn).await {
      Ok(p) => ("127.0.0.1".to_string(), p),
      Err(e) => return Ok(IpcResult::err(e)),
    }
  } else {
    (conn.host.clone(), conn.port)
  };
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => {
      let file_path = match state.file_grants.consume(file_grant.as_deref(), "export_database", &file_path) { Ok(path) => path.to_str().ok_or("Invalid local path encoding")?.to_string(), Err(e) => return Ok(IpcResult::err(e)) };
      match crate::export_import::export_database(
        d,
        &req,
        &file_path,
        &host,
        port,
        &conn.username,
        conn.password.as_deref().unwrap_or(""),
        &conn,
      )
      .await
      {
        Ok(v) => Ok(IpcResult::ok(v)),
        Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
      }
    }
    Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
  }

  }).await;
  Ok(result.unwrap_or_else(IpcResult::err))
}

#[tauri::command]
pub async fn db_import_table(
  app: AppHandle,
  state: State<'_, AppState>,
  req: ImportTableRequest,
  file_path: Option<String>,
  file_grant: Option<String>,
  operation_id: Option<String>,
) -> Result<IpcResult<ImportTableResult>, String> {
  let result = state.operations.run(operation_id.as_deref(), async {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => {
      let file_path = if req.file_content.is_none() {
        let Some(path) = file_path.as_deref() else { return Ok(IpcResult::err("Choose an import file using the system dialog")); };
        match state.file_grants.consume(file_grant.as_deref(), "import_table", path) { Ok(path) => Some(path.to_str().ok_or("Invalid local path encoding")?.to_string()), Err(e) => return Ok(IpcResult::err(e)) }
      } else { None };
      if req.format == "sql" {
        let content = if let Some(content) = &req.file_content { content.clone() } else {
          use std::io::Read;
          let mut content=String::new();
          std::fs::File::open(file_path.as_deref().unwrap()).map_err(|e| e.to_string())?.take(64 * 1024 * 1024 + 1).read_to_string(&mut content).map_err(|e| e.to_string())?;
          content
        };
        if content.len() > 64 * 1024 * 1024 { return Ok(IpcResult::err("Import exceeds the 64 MiB limit; split the SQL file")); }
        let script = match crate::export_import::sql_script::statements(&content, d.dialect()?) { Ok(s) => s, Err(e) => return Ok(IpcResult::err(e)) };
        let excerpt = script.iter().take(8).map(|s| s.chars().take(250).collect::<String>()).collect::<Vec<_>>().join("\n\n");
        let warning = if d.dialect()? == crate::drivers::dialect::SqlDialect::Mysql { "MySQL DDL, non-transactional tables and stored routines can commit changes that cannot be rolled back. / MySQL DDL、非事务表及存储过程可能提交变更，无法保证全部回滚。" } else { "All statements run in one transaction and roll back on failure. / 所有语句在同一事务执行，失败时回滚。" };
        let message = format!("Execute {} SQL statements in {}? / 即将在数据库 {} 执行 {} 条 SQL。\n{}\n\nPreview / 前几条语句：\n{}", script.len(), req.database, req.database, script.len(), warning, excerpt);
        let dialog_app=app.clone();
        let confirmed=tokio::task::spawn_blocking(move || {
          use tauri_plugin_dialog::{DialogExt, MessageDialogKind, MessageDialogButtons};
          dialog_app.dialog().message(message).title("Review SQL import / 核对 SQL 导入").kind(MessageDialogKind::Warning).buttons(MessageDialogButtons::OkCancel).blocking_show()
        }).await.map_err(|e| e.to_string())?;
        if !confirmed { return Ok(IpcResult::ok(ImportTableResult { canceled:true, file_path:None, rows_imported:0, statements_executed:0 })); }
        let mut approved_req=req.clone(); approved_req.file_content=Some(content);
        return Ok(crate::ipc::map_result(crate::export_import::import_table(d, &approved_req, file_path.as_deref()).await));
      }
      match crate::export_import::import_table(d, &req, file_path.as_deref()).await {
        Ok(v) => Ok(IpcResult::ok(v)),
        Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
      }
    }
    Err(e) => Ok(IpcResult::err(state.connection_error(&req.connection_id, e))),
  }

  }).await;
  Ok(result.unwrap_or_else(IpcResult::err))
}

#[tauri::command]
pub async fn db_scan_redis_keys(
  app: AppHandle, state: State<'_, AppState>, connection_id: String, database: String,
  cursor: Option<String>, pattern: Option<String>, operation_id: Option<String>,
) -> Result<IpcResult<crate::types::RedisScanResult>, String> {
  let result = state.operations.run(operation_id.as_deref(), async {
    let driver=state.get_driver(&app, &connection_id).await?;
    match &*driver {
      crate::drivers::EngineDriver::Redis(driver) => driver.scan_keys(&database, cursor.as_deref().unwrap_or("0"), pattern.as_deref()).await,
      _ => Err("Key scanning requires a Redis connection".into()),
    }
  }).await;
  Ok(crate::ipc::map_result(result.map_err(|e| state.connection_error(&connection_id, e))))
}
