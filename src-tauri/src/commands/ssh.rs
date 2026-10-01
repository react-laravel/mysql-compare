use tauri::{AppHandle, State};

use crate::ipc::IpcResult;
use crate::state::AppState;
use crate::types::{
  SSHFileOperationResult, SSHListFilesRequest, SSHListFilesResult, SSHPathRequest, SSHReadFileResult,
  SSHTerminalCloseRequest, SSHTerminalCreateRequest, SSHTerminalCreateResult,
  SSHTerminalResizeRequest, SSHTerminalWriteRequest,
};

async fn full_conn(
  app: &AppHandle,
  state: &AppState,
  id: &str,
) -> Result<crate::types::ConnectionConfig, String> {
  state
    .connections
    .get_full(app, id)?
    .ok_or_else(|| format!("Connection {id} not found"))
}

async fn run_sftp<T: serde::Serialize + Send + 'static>(
  app: AppHandle, state: &AppState, connection_id: &str,
  work: impl FnOnce(AppHandle, crate::store::host_keys::HostKeyStore, crate::types::ConnectionConfig) -> Result<T, String> + Send + 'static,
) -> Result<IpcResult<T>, String> {
  let conn = match full_conn(&app, state, connection_id).await { Ok(c) => c, Err(e) => return Ok(IpcResult::err(e)) };
  let host_keys = state.host_keys.clone();
  Ok(crate::ipc::map_result(tokio::task::spawn_blocking(move || work(app, host_keys, conn)).await.map_err(|e| e.to_string())?))
}

async fn selected_session(app: &AppHandle, state: &AppState, connection_id: &str) -> Result<ssh2::Session, String> {
  let conn = full_conn(app, state, connection_id).await?;
  let app = app.clone();
  let keys = state.host_keys.clone();
  tokio::task::spawn_blocking(move || crate::ssh::tunnel::connect_session(&conn, &keys, &app))
    .await.map_err(|e| e.to_string())?
}
async fn run_transfer<T: serde::Serialize + Send + 'static>(
  session: ssh2::Session,
  work: impl FnOnce(ssh2::Session) -> Result<T, String> + Send + 'static,
) -> Result<IpcResult<T>, String> {
  Ok(crate::ipc::map_result(tokio::task::spawn_blocking(move || work(session)).await.map_err(|e| e.to_string())?))
}

#[tauri::command]
pub async fn ssh_list_files(app: AppHandle, state: State<'_, AppState>, req: SSHListFilesRequest, ) -> Result<IpcResult<SSHListFilesResult>, String> {
  run_sftp(app, &state, &req.connection_id, move |app, keys, conn| crate::ssh::sftp::list_files(&app, &keys, &conn, req.path.as_deref())).await
}

#[tauri::command]
pub async fn ssh_upload_file(app: AppHandle, state: State<'_, AppState>, req: SSHPathRequest, local_path: String, file_grant: Option<String>,) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote_dir = req.remote_dir.unwrap_or_else(|| ".".into());
  // Verify SSH before consuming the one-use selection, so trust-challenge retry remains safe.
  let session = match selected_session(&app, &state, &req.connection_id).await {
    Ok(session) => session, Err(error) => return Ok(IpcResult::err(error)),
  };
  let local_path = match state.file_grants.consume(file_grant.as_deref(), "ssh_upload_file", &local_path) {
    Ok(path) => path.to_str().ok_or("Invalid local path encoding")?.to_string(),
    Err(error) => return Ok(IpcResult::err(error)),
  };
  run_transfer(session, move |session| crate::ssh::sftp::upload_file(session, &remote_dir, &local_path)).await
}

#[tauri::command]
pub async fn ssh_upload_directory(app: AppHandle, state: State<'_, AppState>, req: SSHPathRequest, local_path: String, file_grant: Option<String>,) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote_dir = req.remote_dir.unwrap_or_else(|| ".".into());
  // Verify SSH before consuming the one-use selection, so trust-challenge retry remains safe.
  let session = match selected_session(&app, &state, &req.connection_id).await {
    Ok(session) => session, Err(error) => return Ok(IpcResult::err(error)),
  };
  let local_path = match state.file_grants.consume(file_grant.as_deref(), "ssh_upload_directory", &local_path) {
    Ok(path) => path.to_str().ok_or("Invalid local path encoding")?.to_string(),
    Err(error) => return Ok(IpcResult::err(error)),
  };
  run_transfer(session, move |session| crate::ssh::sftp::upload_directory(session, &remote_dir, &local_path)).await
}

#[tauri::command]
pub async fn ssh_download_file(app: AppHandle, state: State<'_, AppState>, req: SSHPathRequest, local_path: String, file_grant: Option<String>,) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote = req.remote_path.or(req.path).ok_or("remotePath required")?;
  // Verify SSH before consuming the one-use selection, so trust-challenge retry remains safe.
  let session = match selected_session(&app, &state, &req.connection_id).await {
    Ok(session) => session, Err(error) => return Ok(IpcResult::err(error)),
  };
  let local_path = match state.file_grants.consume(file_grant.as_deref(), "ssh_download_file", &local_path) {
    Ok(path) => path.to_str().ok_or("Invalid local path encoding")?.to_string(),
    Err(error) => return Ok(IpcResult::err(error)),
  };
  run_transfer(session, move |session| crate::ssh::sftp::download_file(session, &remote, &local_path)).await
}

#[tauri::command]
pub async fn ssh_download_directory(app: AppHandle, state: State<'_, AppState>, req: SSHPathRequest, local_path: String, file_grant: Option<String>,) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote = req.remote_path.or(req.path).ok_or("remotePath required")?;
  // Verify SSH before consuming the one-use selection, so trust-challenge retry remains safe.
  let session = match selected_session(&app, &state, &req.connection_id).await {
    Ok(session) => session, Err(error) => return Ok(IpcResult::err(error)),
  };
  let local_path = match state.file_grants.consume(file_grant.as_deref(), "ssh_download_directory", &local_path) {
    Ok(path) => path.to_str().ok_or("Invalid local path encoding")?.to_string(),
    Err(error) => return Ok(IpcResult::err(error)),
  };
  run_transfer(session, move |session| crate::ssh::sftp::download_directory(session, &remote, &local_path)).await
}

#[tauri::command]
pub async fn ssh_read_file(app: AppHandle, state: State<'_, AppState>, req: SSHPathRequest, ) -> Result<IpcResult<SSHReadFileResult>, String> {
  let remote = req.remote_path.or(req.path).ok_or("remotePath required")?;
  run_sftp(app, &state, &req.connection_id, move |app, keys, conn| crate::ssh::sftp::read_file(&app, &keys, &conn, &remote)).await
}

#[tauri::command]
pub async fn ssh_write_file(app: AppHandle, state: State<'_, AppState>, req: SSHPathRequest, ) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote = req.remote_path.or(req.path).ok_or("remotePath required")?; let content = req.content.unwrap_or_default();
  run_sftp(app, &state, &req.connection_id, move |app, keys, conn| crate::ssh::sftp::write_file(&app, &keys, &conn, &remote, &content)).await
}

#[tauri::command]
pub async fn ssh_create_directory(app: AppHandle, state: State<'_, AppState>, req: SSHPathRequest, ) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote_dir = req.remote_dir.unwrap_or_else(|| ".".into()); let name = req.name.ok_or("name required")?;
  run_sftp(app, &state, &req.connection_id, move |app, keys, conn| crate::ssh::sftp::create_directory(&app, &keys, &conn, &remote_dir, &name)).await
}

#[tauri::command]
pub async fn ssh_delete_file(app: AppHandle, state: State<'_, AppState>, req: SSHPathRequest, ) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote = req.remote_path.or(req.path).ok_or("remotePath required")?;
  run_sftp(app, &state, &req.connection_id, move |app, keys, conn| crate::ssh::sftp::delete_path(&app, &keys, &conn, &remote)).await
}

#[tauri::command]
pub async fn ssh_move_file(app: AppHandle, state: State<'_, AppState>, req: SSHPathRequest, ) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let from = req.remote_path.or(req.from_path).or(req.path).ok_or("fromPath required")?; let to = req.next_path.or(req.to_path).ok_or("toPath required")?;
  run_sftp(app, &state, &req.connection_id, move |app, keys, conn| crate::ssh::sftp::move_path(&app, &keys, &conn, &from, &to)).await
}

#[tauri::command]
pub async fn ssh_upload_entries(app: AppHandle, state: State<'_, AppState>, req: SSHPathRequest, file_grants: Vec<String>) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let entries = req.entries.as_ref().and_then(|v| v.as_array()).ok_or("entries required")?.clone();
  // Only selected regular files are accepted; directory uploads use their own bounded root grant.
  if entries.len() != file_grants.len() || entries.is_empty() { return Ok(IpcResult::err("Select the files using the system file dialog")); }
  let session = match selected_session(&app, &state, &req.connection_id).await {
    Ok(session) => session, Err(error) => return Ok(IpcResult::err(error)),
  };
  let mut requests = Vec::with_capacity(entries.len());
  for (entry, grant) in entries.iter().zip(&file_grants) {
    if entry.get("type").and_then(|v| v.as_str()) != Some("file") { return Ok(IpcResult::err("Use the directory picker to upload directories")); }
    let relative = entry.get("relativePath").and_then(|v| v.as_str()).ok_or("relativePath required")?;
    if let Err(error) = crate::ssh::sftp::validate_relative_path(relative) { return Ok(IpcResult::err(error)); }
    let path = entry.get("localPath").and_then(|v| v.as_str()).ok_or("localPath required")?;
    requests.push((Some(grant.as_str()), "ssh_upload_entries", path));
  }
  let paths = match state.file_grants.consume_many(&requests) { Ok(paths) => paths, Err(error) => return Ok(IpcResult::err(error)) };
  let entries: Vec<_> = entries.into_iter().zip(paths).map(|(mut entry, path)| {
    entry["localPath"] = serde_json::Value::String(path.to_string_lossy().into_owned()); entry
  }).collect();
  let remote_dir = req.remote_dir.unwrap_or_else(|| ".".into());
  run_transfer(session, move |session| crate::ssh::sftp::upload_entries(session, &remote_dir, &entries)).await
}

#[tauri::command]
pub async fn ssh_terminal_create(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SSHTerminalCreateRequest,
) -> Result<IpcResult<SSHTerminalCreateResult>, String> {
  let conn = match full_conn(&app, &state, &req.connection_id).await { Ok(conn) => conn, Err(e) => return Ok(IpcResult::err(e)) };
  let keys=state.host_keys.clone(); let manager=state.terminals.clone();
  Ok(crate::ipc::map_result(tokio::task::spawn_blocking(move || manager.create(&app, &keys, &conn, req.cols.unwrap_or(100), req.rows.unwrap_or(30))).await.map_err(|e| e.to_string())?))
}

#[tauri::command]
pub async fn ssh_terminal_write(state: State<'_, AppState>, req: SSHTerminalWriteRequest) -> Result<IpcResult<()>, String> {
  let manager=state.terminals.clone();
  Ok(crate::ipc::map_result(tokio::task::spawn_blocking(move || manager.write(&req.session_id, &req.data)).await.map_err(|e|e.to_string())?))
}

#[tauri::command]
pub fn ssh_terminal_resize(
  state: State<'_, AppState>,
  req: SSHTerminalResizeRequest,
) -> IpcResult<()> {
  match state.terminals.resize(&req.session_id, req.cols, req.rows) {
    Ok(()) => IpcResult::ok_empty(),
    Err(e) => IpcResult::err(e),
  }
}

#[tauri::command]
pub fn ssh_terminal_close(
  state: State<'_, AppState>,
  req: SSHTerminalCloseRequest,
) -> IpcResult<()> {
  match state.terminals.close(&req.session_id) {
    Ok(()) => IpcResult::ok_empty(),
    Err(e) => IpcResult::err(e),
  }
}
