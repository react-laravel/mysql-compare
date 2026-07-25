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

#[tauri::command]
pub async fn ssh_list_files(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SSHListFilesRequest,
) -> Result<IpcResult<SSHListFilesResult>, String> {
  match full_conn(&app, &state, &req.connection_id).await {
    Ok(conn) => match crate::ssh::sftp::list_files(&app, &state.host_keys, &conn, req.path.as_deref())
    {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn ssh_upload_file(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SSHPathRequest,
  local_path: String,
) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote_dir = req.remote_dir.unwrap_or_else(|| ".".into());
  match full_conn(&app, &state, &req.connection_id).await {
    Ok(conn) => {
      match crate::ssh::sftp::upload_file(&app, &state.host_keys, &conn, &remote_dir, &local_path) {
        Ok(v) => Ok(IpcResult::ok(v)),
        Err(e) => Ok(IpcResult::err(e)),
      }
    }
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn ssh_upload_directory(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SSHPathRequest,
  local_path: String,
) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote_dir = req.remote_dir.unwrap_or_else(|| ".".into());
  match full_conn(&app, &state, &req.connection_id).await {
    Ok(conn) => match crate::ssh::sftp::upload_directory(
      &app,
      &state.host_keys,
      &conn,
      &remote_dir,
      &local_path,
    ) {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn ssh_upload_entries(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SSHPathRequest,
) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote_dir = req.remote_dir.unwrap_or_else(|| ".".into());
  let entries = match req.entries.as_ref().and_then(|v| v.as_array()) {
    Some(arr) => arr.clone(),
    None => return Ok(IpcResult::err("entries required")),
  };
  match full_conn(&app, &state, &req.connection_id).await {
    Ok(conn) => {
      match crate::ssh::sftp::upload_entries(&app, &state.host_keys, &conn, &remote_dir, &entries) {
        Ok(v) => Ok(IpcResult::ok(v)),
        Err(e) => Ok(IpcResult::err(e)),
      }
    }
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn ssh_download_file(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SSHPathRequest,
  local_path: String,
) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote = req
    .remote_path
    .or(req.path)
    .ok_or_else(|| "remotePath required".to_string());
  let remote = match remote {
    Ok(v) => v,
    Err(e) => return Ok(IpcResult::err(e)),
  };
  match full_conn(&app, &state, &req.connection_id).await {
    Ok(conn) => {
      match crate::ssh::sftp::download_file(&app, &state.host_keys, &conn, &remote, &local_path) {
        Ok(v) => Ok(IpcResult::ok(v)),
        Err(e) => Ok(IpcResult::err(e)),
      }
    }
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn ssh_download_directory(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SSHPathRequest,
  local_path: String,
) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote = req
    .remote_path
    .or(req.path)
    .ok_or_else(|| "remotePath required".to_string());
  let remote = match remote {
    Ok(v) => v,
    Err(e) => return Ok(IpcResult::err(e)),
  };
  match full_conn(&app, &state, &req.connection_id).await {
    Ok(conn) => match crate::ssh::sftp::download_directory(
      &app,
      &state.host_keys,
      &conn,
      &remote,
      &local_path,
    ) {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn ssh_read_file(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SSHPathRequest,
) -> Result<IpcResult<SSHReadFileResult>, String> {
  let remote = req
    .remote_path
    .or(req.path)
    .unwrap_or_default();
  match full_conn(&app, &state, &req.connection_id).await {
    Ok(conn) => match crate::ssh::sftp::read_file(&app, &state.host_keys, &conn, &remote) {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn ssh_write_file(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SSHPathRequest,
) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote = req.remote_path.or(req.path).unwrap_or_default();
  let content = req.content.unwrap_or_default();
  match full_conn(&app, &state, &req.connection_id).await {
    Ok(conn) => {
      match crate::ssh::sftp::write_file(&app, &state.host_keys, &conn, &remote, &content) {
        Ok(v) => Ok(IpcResult::ok(v)),
        Err(e) => Ok(IpcResult::err(e)),
      }
    }
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn ssh_create_directory(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SSHPathRequest,
) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote_dir = req.remote_dir.unwrap_or_else(|| ".".into());
  let name = req.name.unwrap_or_default();
  match full_conn(&app, &state, &req.connection_id).await {
    Ok(conn) => {
      match crate::ssh::sftp::create_directory(&app, &state.host_keys, &conn, &remote_dir, &name) {
        Ok(v) => Ok(IpcResult::ok(v)),
        Err(e) => Ok(IpcResult::err(e)),
      }
    }
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn ssh_delete_file(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SSHPathRequest,
) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let remote = req.remote_path.or(req.path).unwrap_or_default();
  match full_conn(&app, &state, &req.connection_id).await {
    Ok(conn) => match crate::ssh::sftp::delete_path(&app, &state.host_keys, &conn, &remote) {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn ssh_move_file(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SSHPathRequest,
) -> Result<IpcResult<SSHFileOperationResult>, String> {
  let from = req.remote_path.or(req.from_path).or(req.path).unwrap_or_default();
  let to = req.next_path.or(req.to_path).unwrap_or_default();
  match full_conn(&app, &state, &req.connection_id).await {
    Ok(conn) => match crate::ssh::sftp::move_path(&app, &state.host_keys, &conn, &from, &to) {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub async fn ssh_terminal_create(
  app: AppHandle,
  state: State<'_, AppState>,
  req: SSHTerminalCreateRequest,
) -> Result<IpcResult<SSHTerminalCreateResult>, String> {
  match full_conn(&app, &state, &req.connection_id).await {
    Ok(conn) => match state.terminals.create(
      &app,
      &state.host_keys,
      &conn,
      req.cols.unwrap_or(100),
      req.rows.unwrap_or(30),
    ) {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
}

#[tauri::command]
pub fn ssh_terminal_write(
  state: State<'_, AppState>,
  req: SSHTerminalWriteRequest,
) -> IpcResult<()> {
  match state.terminals.write(&req.session_id, &req.data) {
    Ok(()) => IpcResult::ok_empty(),
    Err(e) => IpcResult::err(e),
  }
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
