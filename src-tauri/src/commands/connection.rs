use tauri::{AppHandle, State};

use crate::ipc::{map_result, IpcResult};
use crate::state::AppState;
use crate::types::{ConnectionConfig, ConnectionOrganizationItem, DatabaseCredentialConfig, SafeConnection};

#[tauri::command]
pub fn connection_list(state: State<'_, AppState>) -> IpcResult<Vec<SafeConnection>> {
  IpcResult::ok(state.connections.list_safe())
}

#[tauri::command]
pub fn connection_organize(
  state: State<'_, AppState>,
  items: Vec<ConnectionOrganizationItem>,
) -> IpcResult<Vec<SafeConnection>> {
  map_result(state.connections.organize(items))
}

#[tauri::command]
pub async fn connection_upsert(
  app: AppHandle,
  state: State<'_, AppState>,
  conn: ConnectionConfig,
) -> Result<IpcResult<SafeConnection>, String> {
  match state.connections.upsert(&app, conn) {
    Ok(safe) => {
      // 编辑后的 host/password/SSH 配置需立即生效：清掉旧 driver 与隧道缓存。
      state.close_connection(&safe.id).await;
      Ok(IpcResult::ok(safe))
    }
    Err(e) => Ok(IpcResult::err(e)),
  }
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
  let result = state.connections.set_database_credential(&app, &id, &database, credential);
  if result.is_ok() { state.invalidate_driver(&id); }
  map_result(result)
}

#[tauri::command]
pub fn connection_update_database_browsing(app: AppHandle, state: State<'_, AppState>, id: String, database: Option<String>, show_all: Option<bool>, credential: Option<DatabaseCredentialConfig>) -> IpcResult<SafeConnection> {
  let result = state.connections.update_database_browsing(&app, &id, database, show_all, credential);
  if result.is_ok() { state.invalidate_driver(&id); }
  map_result(result)
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
  if let Some(resolved) = crate::drivers::connection_options::resolve_credential(&conn, &database, credential) {
    conn.username = resolved.username.unwrap();
    conn.password = Some(resolved.password.unwrap_or_default());
  }
  conn.database_credentials = None;
  conn.database = Some(database);
  match state.test_database_connection(&app, &conn).await {
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
