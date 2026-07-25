use tauri::{AppHandle, State};

use crate::ipc::IpcResult;
use crate::state::AppState;
use crate::types::{SyncPlan, SyncRequest};

#[tauri::command]
pub async fn sync_build_plan(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SyncRequest,
) -> Result<IpcResult<SyncPlan>, String> {
  let source = match state.get_driver(&app, &req.source_connection_id).await {
    Ok(d) => d,
    Err(e) => return Ok(IpcResult::err(e)),
  };
  let target = match state.get_driver(&app, &req.target_connection_id).await {
    Ok(d) => d,
    Err(e) => return Ok(IpcResult::err(e)),
  };
  match crate::sync::build_plan(source, target, &req).await {
    Ok(v) => Ok(IpcResult::ok(v)),
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn sync_execute(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SyncRequest,
) -> Result<IpcResult<serde_json::Value>, String> {
  let source = match state.get_driver(&app, &req.source_connection_id).await {
    Ok(d) => d,
    Err(e) => return Ok(IpcResult::err(e)),
  };
  let target = match state.get_driver(&app, &req.target_connection_id).await {
    Ok(d) => d,
    Err(e) => return Ok(IpcResult::err(e)),
  };
  match crate::sync::execute(&app, source, target, &req).await {
    Ok((executed, errors)) => Ok(IpcResult::ok(serde_json::json!({
      "executed": executed,
      "errors": errors
    }))),
    Err(e) => Ok(IpcResult::err(e)),
  }
}
