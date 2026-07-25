use std::io::{Read, Write};
use std::path::{Component, Path};

use tauri::AppHandle;

use crate::ssh::tunnel::connect_session;
use crate::store::host_keys::HostKeyStore;
use crate::types::{
  ConnectionConfig, SSHFileEntry, SSHFileOperationResult, SSHListFilesResult, SSHReadFileResult,
};

fn normalize_remote(path: &str) -> String {
  let p = path.trim();
  if p.is_empty() || p == "." {
    return ".".into();
  }
  p.replace('\\', "/").trim_end_matches('/').to_string()
}

fn join_remote(dir: &str, name: &str) -> String {
  if dir == "." || dir.is_empty() {
    name.to_string()
  } else if dir.ends_with('/') {
    format!("{dir}{name}")
  } else {
    format!("{dir}/{name}")
  }
}

fn parent_remote(path: &str) -> Option<String> {
  if path == "/" || path == "." {
    return None;
  }
  let trimmed = path.trim_end_matches('/');
  trimmed.rfind('/').map(|i| {
    if i == 0 {
      "/".into()
    } else {
      trimmed[..i].to_string()
    }
  })
}

pub fn list_files(
  app: &AppHandle,
  host_keys: &HostKeyStore,
  conn: &ConnectionConfig,
  path: Option<&str>,
) -> Result<SSHListFilesResult, String> {
  let remote = normalize_remote(path.unwrap_or("."));
  let sess = connect_session(conn, host_keys, app)?;
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  let mut entries = Vec::new();
  for item in sftp.readdir(Path::new(&remote)).map_err(|e| e.to_string())? {
    let (p, stat) = item;
    let name = p
      .file_name()
      .and_then(|s| s.to_str())
      .unwrap_or("")
      .to_string();
    if name == "." || name == ".." {
      continue;
    }
    let entry_type = if stat.is_dir() {
      "directory"
    } else if stat.file_type().is_symlink() {
      "symlink"
    } else if stat.is_file() {
      "file"
    } else {
      "other"
    };
    entries.push(SSHFileEntry {
      name: name.clone(),
      path: join_remote(&remote, &name),
      entry_type: entry_type.into(),
      size: stat.size.unwrap_or(0),
      modified_at: stat.mtime.map(|t| (t as i64) * 1000),
      permissions: format!("0{:o}", stat.perm.unwrap_or(0) & 0o777),
    });
  }
  entries.sort_by(|a, b| match (a.entry_type.as_str(), b.entry_type.as_str()) {
    ("directory", "directory") => a.name.cmp(&b.name),
    ("directory", _) => std::cmp::Ordering::Less,
    (_, "directory") => std::cmp::Ordering::Greater,
    _ => a.name.cmp(&b.name),
  });
  Ok(SSHListFilesResult {
    path: remote.clone(),
    parent_path: parent_remote(&remote),
    entries,
  })
}

pub fn read_file(
  app: &AppHandle,
  host_keys: &HostKeyStore,
  conn: &ConnectionConfig,
  remote_path: &str,
) -> Result<SSHReadFileResult, String> {
  let sess = connect_session(conn, host_keys, app)?;
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  let mut file = sftp
    .open(Path::new(remote_path))
    .map_err(|e| e.to_string())?;
  let mut buf = Vec::new();
  file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
  if buf.contains(&0) {
    return Err("Binary file cannot be opened in editor".into());
  }
  let content = String::from_utf8(buf).map_err(|e| e.to_string())?;
  Ok(SSHReadFileResult {
    path: remote_path.to_string(),
    content,
  })
}

pub fn write_file(
  app: &AppHandle,
  host_keys: &HostKeyStore,
  conn: &ConnectionConfig,
  remote_path: &str,
  content: &str,
) -> Result<SSHFileOperationResult, String> {
  let sess = connect_session(conn, host_keys, app)?;
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  let mut file = sftp
    .create(Path::new(remote_path))
    .map_err(|e| e.to_string())?;
  file
    .write_all(content.as_bytes())
    .map_err(|e| e.to_string())?;
  Ok(SSHFileOperationResult {
    canceled: false,
    local_path: None,
    remote_path: Some(remote_path.to_string()),
    path: Some(remote_path.to_string()),
    message: None,
  })
}

pub fn create_directory(
  app: &AppHandle,
  host_keys: &HostKeyStore,
  conn: &ConnectionConfig,
  remote_dir: &str,
  name: &str,
) -> Result<SSHFileOperationResult, String> {
  let path = join_remote(remote_dir, name);
  let sess = connect_session(conn, host_keys, app)?;
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  sftp.mkdir(Path::new(&path), 0o755).map_err(|e| e.to_string())?;
  Ok(SSHFileOperationResult {
    canceled: false,
    local_path: None,
    remote_path: Some(path.clone()),
    path: Some(path),
    message: None,
  })
}

pub fn delete_path(
  app: &AppHandle,
  host_keys: &HostKeyStore,
  conn: &ConnectionConfig,
  remote_path: &str,
) -> Result<SSHFileOperationResult, String> {
  if remote_path == "/" || remote_path == "." {
    return Err("Refusing to delete root".into());
  }
  let sess = connect_session(conn, host_keys, app)?;
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  let meta = sftp.stat(Path::new(remote_path)).map_err(|e| e.to_string())?;
  if meta.is_dir() {
    sftp.rmdir(Path::new(remote_path)).map_err(|e| e.to_string())?;
  } else {
    sftp.unlink(Path::new(remote_path)).map_err(|e| e.to_string())?;
  }
  Ok(SSHFileOperationResult {
    canceled: false,
    local_path: None,
    remote_path: Some(remote_path.to_string()),
    path: Some(remote_path.to_string()),
    message: None,
  })
}

pub fn move_path(
  app: &AppHandle,
  host_keys: &HostKeyStore,
  conn: &ConnectionConfig,
  from: &str,
  to: &str,
) -> Result<SSHFileOperationResult, String> {
  let sess = connect_session(conn, host_keys, app)?;
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  if sftp.stat(Path::new(to)).is_ok() {
    return Err("Target already exists".into());
  }
  sftp
    .rename(Path::new(from), Path::new(to), None)
    .map_err(|e| e.to_string())?;
  Ok(SSHFileOperationResult {
    canceled: false,
    local_path: None,
    remote_path: Some(to.to_string()),
    path: Some(to.to_string()),
    message: None,
  })
}

pub fn upload_file(
  app: &AppHandle,
  host_keys: &HostKeyStore,
  conn: &ConnectionConfig,
  remote_dir: &str,
  local_path: &str,
) -> Result<SSHFileOperationResult, String> {
  let name = Path::new(local_path)
    .file_name()
    .and_then(|s| s.to_str())
    .ok_or_else(|| "Invalid local path".to_string())?;
  let remote = join_remote(remote_dir, name);
  let data = std::fs::read(local_path).map_err(|e| e.to_string())?;
  let sess = connect_session(conn, host_keys, app)?;
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  if sftp.stat(Path::new(&remote)).is_ok() {
    return Err("Remote file already exists".into());
  }
  let mut file = sftp.create(Path::new(&remote)).map_err(|e| e.to_string())?;
  file.write_all(&data).map_err(|e| e.to_string())?;
  Ok(SSHFileOperationResult {
    canceled: false,
    local_path: None,
    remote_path: Some(remote.clone()),
    path: Some(remote),
    message: None,
  })
}

pub fn download_file(
  app: &AppHandle,
  host_keys: &HostKeyStore,
  conn: &ConnectionConfig,
  remote_path: &str,
  local_path: &str,
) -> Result<SSHFileOperationResult, String> {
  let sess = connect_session(conn, host_keys, app)?;
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  let mut file = sftp.open(Path::new(remote_path)).map_err(|e| e.to_string())?;
  let mut buf = Vec::new();
  file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
  std::fs::write(local_path, buf).map_err(|e| e.to_string())?;
  Ok(SSHFileOperationResult {
    canceled: false,
    local_path: None,
    remote_path: Some(local_path.to_string()),
    path: Some(local_path.to_string()),
    message: None,
  })
}

pub fn upload_directory(
  app: &AppHandle,
  host_keys: &HostKeyStore,
  conn: &ConnectionConfig,
  remote_dir: &str,
  local_path: &str,
) -> Result<SSHFileOperationResult, String> {
  let base = Path::new(local_path);
  let folder_name = base
    .file_name()
    .and_then(|s| s.to_str())
    .ok_or_else(|| "Invalid directory".to_string())?;
  let remote_root = join_remote(remote_dir, folder_name);
  let sess = connect_session(conn, host_keys, app)?;
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  sftp
    .mkdir(Path::new(&remote_root), 0o755)
    .map_err(|e| e.to_string())?;
  upload_tree(&sftp, base, &remote_root)?;
  Ok(SSHFileOperationResult {
    canceled: false,
    local_path: None,
    remote_path: Some(remote_root.clone()),
    path: Some(remote_root),
    message: None,
  })
}

fn upload_tree(sftp: &ssh2::Sftp, local: &Path, remote: &str) -> Result<(), String> {
  for entry in std::fs::read_dir(local).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    let name = entry.file_name();
    let name = name.to_string_lossy();
    let remote_path = join_remote(remote, &name);
    let ft = entry.file_type().map_err(|e| e.to_string())?;
    if ft.is_dir() {
      sftp
        .mkdir(Path::new(&remote_path), 0o755)
        .map_err(|e| e.to_string())?;
      upload_tree(sftp, &entry.path(), &remote_path)?;
    } else if ft.is_file() {
      let data = std::fs::read(entry.path()).map_err(|e| e.to_string())?;
      let mut file = sftp
        .create(Path::new(&remote_path))
        .map_err(|e| e.to_string())?;
      file.write_all(&data).map_err(|e| e.to_string())?;
    }
  }
  Ok(())
}

pub fn download_directory(
  app: &AppHandle,
  host_keys: &HostKeyStore,
  conn: &ConnectionConfig,
  remote_path: &str,
  local_dir: &str,
) -> Result<SSHFileOperationResult, String> {
  let name = Path::new(remote_path)
    .file_name()
    .and_then(|s| s.to_str())
    .unwrap_or("download");
  let dest = Path::new(local_dir).join(name);
  std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
  let sess = connect_session(conn, host_keys, app)?;
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  download_tree(&sftp, remote_path, &dest)?;
  Ok(SSHFileOperationResult {
    canceled: false,
    local_path: None,
    remote_path: Some(dest.to_string_lossy().into()),
    path: Some(dest.to_string_lossy().into()),
    message: None,
  })
}

fn download_tree(sftp: &ssh2::Sftp, remote: &str, local: &Path) -> Result<(), String> {
  for item in sftp.readdir(Path::new(remote)).map_err(|e| e.to_string())? {
    let (p, stat) = item;
    let name = p
      .file_name()
      .and_then(|s| s.to_str())
      .unwrap_or("")
      .to_string();
    if name == "." || name == ".." {
      continue;
    }
    let remote_child = join_remote(remote, &name);
    let local_child = local.join(&name);
    if stat.is_dir() {
      std::fs::create_dir_all(&local_child).map_err(|e| e.to_string())?;
      download_tree(sftp, &remote_child, &local_child)?;
    } else if stat.is_file() {
      let mut file = sftp
        .open(Path::new(&remote_child))
        .map_err(|e| e.to_string())?;
      let mut buf = Vec::new();
      file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
      std::fs::write(local_child, buf).map_err(|e| e.to_string())?;
    }
  }
  Ok(())
}

pub fn upload_entries(
  app: &AppHandle,
  host_keys: &HostKeyStore,
  conn: &ConnectionConfig,
  remote_dir: &str,
  entries: &[serde_json::Value],
) -> Result<SSHFileOperationResult, String> {
  let sess = connect_session(conn, host_keys, app)?;
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  for entry in entries {
    let entry_type = entry.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let relative = entry
      .get("relativePath")
      .and_then(|v| v.as_str())
      .ok_or_else(|| "relativePath required".to_string())?;
    if relative.contains("..") {
      return Err("Invalid relative path".into());
    }
    let remote = join_remote(remote_dir, relative);
    if entry_type == "directory" {
      // create nested dirs
      let mut acc = remote_dir.to_string();
      for part in Path::new(relative).components() {
        if let Component::Normal(p) = part {
          acc = join_remote(&acc, &p.to_string_lossy());
          let _ = sftp.mkdir(Path::new(&acc), 0o755);
        }
      }
    } else {
      let local = entry
        .get("localPath")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "localPath required".to_string())?;
      if let Some(parent) = Path::new(&remote).parent() {
        let _ = sftp.mkdir(parent, 0o755);
      }
      if sftp.stat(Path::new(&remote)).is_ok() {
        return Err(format!("Remote path already exists: {remote}"));
      }
      let data = std::fs::read(local).map_err(|e| e.to_string())?;
      let mut file = sftp.create(Path::new(&remote)).map_err(|e| e.to_string())?;
      file.write_all(&data).map_err(|e| e.to_string())?;
    }
  }
  Ok(SSHFileOperationResult {
    canceled: false,
    local_path: None,
    remote_path: Some(remote_dir.to_string()),
    path: Some(remote_dir.to_string()),
    message: None,
  })
}
