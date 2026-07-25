use tauri::{AppHandle, State};

use crate::ipc::{map_result, IpcResult};
use crate::state::AppState;
use crate::types::{ConnectionConfig, DatabaseCredentialConfig, SafeConnection};

#[tauri::command]
pub fn connection_list(state: State<'_, AppState>) -> IpcResult<Vec<SafeConnection>> {
  IpcResult::ok(state.connections.list_safe())
}

#[tauri::command]
pub fn connection_upsert(
  app: AppHandle,
  state: State<'_, AppState>,
  conn: ConnectionConfig,
) -> IpcResult<SafeConnection> {
  map_result(state.connections.upsert(&app, conn))
}

#[tauri::command]
pub async fn connection_remove(
  state: State<'_, AppState>,
  id: String,
) -> Result<IpcResult<()>, String> {
  if let Err(e) = state.connections.remove(&id) {
    return Ok(IpcResult::err(e));
  }
  state.close_connection(&id).await;
  Ok(IpcResult::ok_empty())
}

#[tauri::command]
pub async fn connection_close(state: State<'_, AppState>, id: String) -> Result<IpcResult<()>, String> {
  state.close_connection(&id).await;
  Ok(IpcResult::ok_empty())
}

#[tauri::command]
pub fn connection_set_database_credential(
  app: AppHandle,
  state: State<'_, AppState>,
  id: String,
  database: String,
  credential: DatabaseCredentialConfig,
) -> IpcResult<SafeConnection> {
  map_result(state.connections.set_database_credential(&app, &id, &database, credential))
}

#[tauri::command]
pub async fn connection_test_database_credential(
  app: AppHandle,
  state: State<'_, AppState>,
  id: String,
  database: String,
  credential: DatabaseCredentialConfig,
) -> Result<IpcResult<serde_json::Value>, String> {
  let mut conn = match state.connections.get_full(&app, &id) {
    Ok(Some(c)) => c,
    Ok(None) => return Ok(IpcResult::err("Connection not found")),
    Err(e) => return Ok(IpcResult::err(e)),
  };
  conn.username = credential.username.unwrap_or(conn.username);
  if let Some(pw) = credential.password {
    conn.password = Some(pw);
  }
  conn.database = Some(database);
  match state.test_connection(&app, &conn).await {
    Ok(message) => Ok(IpcResult::ok(serde_json::json!({ "message": message }))),
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn connection_test(
  app: AppHandle,
  state: State<'_, AppState>,
  conn: ConnectionConfig,
) -> Result<IpcResult<serde_json::Value>, String> {
  match state.test_connection(&app, &conn).await {
    Ok(message) => Ok(IpcResult::ok(serde_json::json!({ "message": message }))),
    Err(e) => Ok(IpcResult::err(e)),
  }
}
