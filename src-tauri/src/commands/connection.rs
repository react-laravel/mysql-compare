use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::ipc::{map_result, IpcResult};
use crate::state::AppState;
use crate::types::{ConnectionConfig, ConnectionOrganizationItem, DatabaseCredentialConfig, SafeConnection};
use crate::store::host_keys::TrustedHostKey;

#[tauri::command]
pub fn ssh_host_key_list(state: State<'_, AppState>) -> IpcResult<Vec<TrustedHostKey>> {
  map_result(state.host_keys.list())
}

#[tauri::command]
pub async fn ssh_host_key_confirm(
  app: AppHandle,
  state: State<'_, AppState>,
  challenge_id: String,
  fingerprint: String,
) -> Result<IpcResult<bool>, String> {
  let store = state.host_keys.clone();
  let endpoint = match store.pending_confirmation(&challenge_id, &fingerprint) {
    Ok(challenge) => (challenge.host, challenge.port),
    Err(error) => return Ok(IpcResult::err(error)),
  };
  let result = tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
    let challenge = store.pending_confirmation(&challenge_id, &fingerprint)?;
    let host = serde_json::to_string(&challenge.host).map_err(|e| e.to_string())?;
    let previous = challenge.previous_fingerprint.as_deref().unwrap_or("首次连接 / First connection");
    let message = format!(
      "SSH 主机 / Host: {host}:{}\n\n原指纹 / Previous fingerprint:\n{previous}\n\n当前指纹 / Current fingerprint:\n{}\n\n请先通过可信渠道向服务器管理员核对指纹。密钥变化可能表示服务器重装，也可能是中间人攻击。只有核对一致后才能信任。\nVerify this fingerprint with the server administrator through a trusted channel before accepting it. A changed key may indicate a server rebuild or a man-in-the-middle attack.\n\n是否信任此密钥？ / Trust this key?",
      challenge.port, challenge.fingerprint,
    );
    // This native dialog is deliberately owned by the backend: invoking the
    // command from renderer JavaScript cannot silently approve a host key.
    let accepted = app.dialog().message(message).title("验证 SSH 主机身份 / Verify SSH identity")
      .kind(MessageDialogKind::Warning)
      .buttons(MessageDialogButtons::OkCancelCustom("已核对，信任 / Verified, trust".into(), "取消 / Cancel".into()))
      .blocking_show();
    if accepted { store.confirm(&challenge_id, &fingerprint)?; }
    Ok(accepted)
  }).await.map_err(|e| format!("SSH identity confirmation task: {e}"));
  let result = result.and_then(|result| result);
  if matches!(&result, Ok(true)) { close_host_connections(&state, &endpoint.0, endpoint.1).await; }
  Ok(map_result(result))
}

#[tauri::command]
pub async fn ssh_host_key_forget(
  app: AppHandle,
  state: State<'_, AppState>,
  host: String,
  port: u16,
  fingerprint: String,
) -> Result<IpcResult<bool>, String> {
  let store = state.host_keys.clone();
  let endpoint = (host.clone(), port);
  let result = tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
    if !store.list()?.iter().any(|key| key.host == host && key.port == port && key.fingerprint == fingerprint) {
      return Err("Saved SSH identity changed; refresh the fingerprint before removing it".into());
    }
    let display_host = serde_json::to_string(&host).map_err(|e| e.to_string())?;
    let accepted = app.dialog().message(format!("移除 SSH 主机信任 / Remove SSH trust\n\n{display_host}:{port}\n{fingerprint}\n\n下次连接必须重新核对指纹。\nThe next connection will require verification again."))
      .title("移除 SSH 信任 / Remove SSH trust").kind(MessageDialogKind::Warning)
      .buttons(MessageDialogButtons::OkCancel).blocking_show();
    if accepted { store.forget(&host, port, &fingerprint)?; }
    Ok(accepted)
  }).await.map_err(|e| format!("SSH identity removal task: {e}"));
  let result = result.and_then(|result| result);
  if matches!(&result, Ok(true)) { close_host_connections(&state, &endpoint.0, endpoint.1).await; }
  Ok(map_result(result))
}

async fn close_host_connections(state: &AppState, host: &str, port: u16) {
  let ids: Vec<_> = state.connections.list_safe().into_iter()
    .filter(|connection| connection.use_ssh && connection.ssh_host.as_deref() == Some(host) && connection.ssh_port.unwrap_or(22) == port)
    .map(|connection| connection.id).collect();
  for id in ids { state.close_connection(&id).await; }
}

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
