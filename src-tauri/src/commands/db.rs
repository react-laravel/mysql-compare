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
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
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
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn db_list_tables(
  app: AppHandle,
  state: State<'_, AppState>,
  connection_id: String,
  database: String,
) -> Result<IpcResult<Vec<String>>, String> {
  match state.get_driver(&app, &connection_id).await {
    Ok(d) => match d.list_tables(&database).await {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn db_query_rows(
  app: AppHandle,
  state: State<'_, AppState>,
  req: QueryRowsRequest,
) -> Result<IpcResult<QueryRowsResult>, String> {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => match d.query_rows(&req).await {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
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
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
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
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
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
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn db_execute_sql(
  app: AppHandle,
  state: State<'_, AppState>,
  connection_id: String,
  sql: String,
  database: Option<String>,
) -> Result<IpcResult<serde_json::Value>, String> {
  match state.get_driver(&app, &connection_id).await {
    Ok(d) => match d.execute_sql(&sql, database.as_deref()).await {
      Ok(()) => Ok(IpcResult::ok(serde_json::json!({ "ok": true }))),
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn db_explain_sql(
  app: AppHandle,
  state: State<'_, AppState>,
  req: ExplainSQLRequest,
) -> Result<IpcResult<ExplainSQLResult>, String> {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => match d.explain_sql(&req.sql, req.database.as_deref()).await {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
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
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
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
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
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
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
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
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
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
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn db_export_table(
  app: AppHandle,
  state: State<'_, AppState>,
  req: ExportTableRequest,
  file_path: String,
) -> Result<IpcResult<ExportTableResult>, String> {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => match crate::export_import::export_table(d, &req, &file_path).await {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn db_export_database(
  app: AppHandle,
  state: State<'_, AppState>,
  req: ExportDatabaseRequest,
  file_path: String,
) -> Result<IpcResult<ExportDatabaseResult>, String> {
  let conn = match state.connections.get_full(&app, &req.connection_id) {
    Ok(Some(c)) => c,
    Ok(None) => return Ok(IpcResult::err("Connection not found")),
    Err(e) => return Ok(IpcResult::err(e)),
  };
  let (host, port) = if conn.use_ssh {
    match state.tunnels.ensure(&app, &state.host_keys, &conn) {
      Ok(p) => ("127.0.0.1".to_string(), p),
      Err(e) => return Ok(IpcResult::err(e)),
    }
  } else {
    (conn.host.clone(), conn.port)
  };
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => {
      match crate::export_import::export_database(
        d,
        &req,
        &file_path,
        &host,
        port,
        &conn.username,
        conn.password.as_deref().unwrap_or(""),
      )
      .await
      {
        Ok(v) => Ok(IpcResult::ok(v)),
        Err(e) => Ok(IpcResult::err(e)),
      }
    }
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn db_import_table(
  app: AppHandle,
  state: State<'_, AppState>,
  req: ImportTableRequest,
  file_path: Option<String>,
) -> Result<IpcResult<ImportTableResult>, String> {
  match state.get_driver(&app, &req.connection_id).await {
    Ok(d) => {
      match crate::export_import::import_table(d, &req, file_path.as_deref()).await {
        Ok(v) => Ok(IpcResult::ok(v)),
        Err(e) => Ok(IpcResult::err(e)),
      }
    }
    Err(e) => Ok(IpcResult::err(e)),
  }
}
