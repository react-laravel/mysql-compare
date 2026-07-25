use tauri::{AppHandle, State};

use crate::ipc::IpcResult;
use crate::state::AppState;
use crate::types::{DatabaseDiff, DiffRequest, TableComparisonResult, TableDiffRequest};

#[tauri::command]
pub async fn diff_databases(
  app: AppHandle,
  state: State<'_, AppState>,
  req: DiffRequest,
) -> Result<IpcResult<DatabaseDiff>, String> {
  let source = match state.get_driver(&app, &req.source_connection_id).await {
    Ok(d) => d,
    Err(e) => return Ok(IpcResult::err(e)),
  };
  let target = match state.get_driver(&app, &req.target_connection_id).await {
    Ok(d) => d,
    Err(e) => return Ok(IpcResult::err(e)),
  };
  match crate::diff::diff_databases(
    source,
    &req.source_database,
    target,
    &req.target_database,
    req.compare_data.unwrap_or(false),
  )
  .await
  {
    Ok(v) => Ok(IpcResult::ok(v)),
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn diff_table(
  app: AppHandle,
  state: State<'_, AppState>,
  req: TableDiffRequest,
) -> Result<IpcResult<TableComparisonResult>, String> {
  let source = match state.get_driver(&app, &req.source_connection_id).await {
    Ok(d) => d,
    Err(e) => return Ok(IpcResult::err(e)),
  };
  let target = match state.get_driver(&app, &req.target_connection_id).await {
    Ok(d) => d,
    Err(e) => return Ok(IpcResult::err(e)),
  };
  match crate::diff::diff_table(
    source,
    &req.source_database,
    &req.source_table,
    target,
    &req.target_database,
    &req.target_table,
    req.compare_data.unwrap_or(true),
  )
  .await
  {
    Ok(v) => Ok(IpcResult::ok(v)),
    Err(e) => Ok(IpcResult::err(e)),
  }
}
