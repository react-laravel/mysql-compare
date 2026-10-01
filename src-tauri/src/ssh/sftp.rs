use std::io::{Read, Write};
use std::path::{Component, Path};

const MAX_EDITOR_BYTES: u64 = 8 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES: usize = 20_000;
const MAX_TRANSFER_ENTRIES: usize = 100_000;
const MAX_TRANSFER_DEPTH: usize = 64;

pub(crate) fn validate_relative_path(path: &str) -> Result<(), String> {
  if path.is_empty() || path.contains(['\\', ':', '\0']) || path.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
    return Err("Invalid relative path".into());
  }
  if Path::new(path).components().any(|component| !matches!(component, Component::Normal(_))) {
    return Err("Invalid relative path".into());
  }
  Ok(())
}
fn validate_child_name(name: &str) -> Result<(), String> {
  validate_relative_path(name)?;
  if name.contains('/') { return Err("Remote entry is not a single file name".into()); }
  Ok(())
}
fn checked_directory(path: &Path, root: &Path) -> Result<(), String> {
  let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
  if !metadata.is_dir() || metadata.file_type().is_symlink() || !path.canonicalize().map_err(|e| e.to_string())?.starts_with(root) {
    return Err("Local directory changed or escapes the selected root".into());
  }
  Ok(())
}
fn open_source(path: &Path, root: Option<&Path>) -> Result<std::fs::File, String> {
  if let Some(root) = root {
    if !path.canonicalize().map_err(|e| e.to_string())?.starts_with(root) { return Err("Local source escapes the selected directory".into()); }
  }
  let mut options = std::fs::OpenOptions::new();
  options.read(true);
  #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK); }
  let source = options.open(path).map_err(|e| e.to_string())?;
  if !source.metadata().map_err(|e| e.to_string())?.is_file() { return Err("Only regular local files can be uploaded".into()); }
  Ok(source)
}
fn copy_stream(source: &mut impl Read, target: &mut impl Write) -> Result<(), String> {
  let mut buffer = [0u8; 64 * 1024];
  loop {
    crate::operations::check()?;
    let count = source.read(&mut buffer).map_err(|e| e.to_string())?;
    if count == 0 { return Ok(()); }
    target.write_all(&buffer[..count]).map_err(|e| e.to_string())?;
  }
}
fn visit_entry(remaining: &mut usize, depth: usize) -> Result<(), String> {
  if *remaining == 0 || depth > MAX_TRANSFER_DEPTH { return Err("Directory transfer exceeds 100,000 entries or 64 nested levels; choose a smaller directory".into()); }
  *remaining -= 1;
  crate::operations::check()
}

fn read_text_bounded(reader: &mut impl Read) -> Result<String, String> {
  let mut buf = Vec::new();
  reader.take(MAX_EDITOR_BYTES + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
  if buf.len() as u64 > MAX_EDITOR_BYTES { return Err("File exceeds the 8 MiB editor limit; use Download instead".into()); }
  if buf.contains(&0) { return Err("Binary file cannot be opened in editor".into()); }
  String::from_utf8(buf).map_err(|e| e.to_string())
}


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
  if p.chars().all(|c| c == '/') { return "/".into(); }
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
  let mut directory = sftp.opendir(Path::new(&remote)).map_err(|e| e.to_string())?;
  let mut truncated = false;
  loop {
    let (p, stat) = match directory.readdir() {
      Ok(item) => item,
      Err(e) if e.code() == ssh2::ErrorCode::SFTP(1) => break,
      Err(e) => return Err(e.to_string()),
    };
    if entries.len() >= MAX_DIRECTORY_ENTRIES { truncated = true; break; }
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
    truncated: Some(truncated),
  })
}

pub fn read_file(
  app: &AppHandle,
  host_keys: &HostKeyStore,
  conn: &ConnectionConfig,
  remote_path: &str,
) -> Result<SSHReadFileResult, String> {
  let sess = connect_session(conn, host_keys, app)?;
  read_file_with_session(sess, remote_path)
}
pub(crate) fn read_file_with_session(sess: ssh2::Session, remote_path: &str) -> Result<SSHReadFileResult, String> {
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  let mut file = sftp
    .open(Path::new(remote_path))
    .map_err(|e| e.to_string())?;
  if file.stat().map_err(|e| e.to_string())?.size.unwrap_or(0) > MAX_EDITOR_BYTES { return Err("File exceeds the 8 MiB editor limit; use Download instead".into()); }
  let content = read_text_bounded(&mut file)?;
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
  if content.len() as u64 > MAX_EDITOR_BYTES { return Err("File exceeds the 8 MiB editor limit".into()); }
  let sess = connect_session(conn, host_keys, app)?;
  write_file_with_session(sess, remote_path, content)
}
pub(crate) fn write_file_with_session(sess: ssh2::Session, remote_path: &str, content: &str) -> Result<SSHFileOperationResult, String> {
  if content.len() as u64 > MAX_EDITOR_BYTES { return Err("File exceeds the 8 MiB editor limit".into()); }
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  let metadata = sftp.lstat(Path::new(remote_path)).map_err(|e| format!("Read original file metadata before atomic replacement: {e}"))?;
  if !metadata.is_file() || metadata.file_type().is_symlink() {
    return Err("Only regular remote files can be edited; open a symbolic link's resolved target instead".into());
  }
  let mode = metadata.perm.ok_or("Server did not report the original permissions; atomic editing was canceled to preserve the file")? & 0o7777;
  let temporary = format!("{remote_path}.mysql-compare-{}.part", uuid::Uuid::new_v4());
  let prepared = (|| {
    write_remote_temp(&sftp, &mut std::io::Cursor::new(content.as_bytes()), &temporary)?;
    sftp.setstat(Path::new(&temporary), ssh2::FileStat { size: None, uid: metadata.uid, gid: metadata.gid, perm: Some(mode), atime: None, mtime: None }).map_err(|e| format!("Preserve original file metadata before replacement: {e}"))?;
    let copied = sftp.lstat(Path::new(&temporary)).map_err(|e| e.to_string())?;
    if copied.perm.map(|permissions| permissions & 0o7777) != Some(mode) || metadata.uid.is_some_and(|uid| copied.uid != Some(uid)) || metadata.gid.is_some_and(|gid| copied.gid != Some(gid)) {
      return Err("Server could not preserve the original file permissions or ownership; the original file was preserved".into());
    }
    Ok(())
  })();
  if let Err(error) = prepared { let _ = sftp.unlink(Path::new(&temporary)); return Err(error); }
  // Closing the regular SFTP channel also supports servers limited to one
  // subsystem channel per SSH session. Identity/authentication stay pinned.
  drop(sftp);
  if let Err(error) = super::sftp_atomic::replace(&sess, &temporary, remote_path) {
    if let Ok(cleanup) = sess.sftp() { let _ = cleanup.unlink(Path::new(&temporary)); }
    return Err(error);
  }
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
  sess: ssh2::Session,
  remote_dir: &str,
  local_path: &str,
) -> Result<SSHFileOperationResult, String> {
  let name = Path::new(local_path)
    .file_name()
    .and_then(|s| s.to_str())
    .ok_or_else(|| "Invalid local path".to_string())?;
  let remote = join_remote(remote_dir, name);
  let mut source = open_source(Path::new(local_path), None)?;
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  if sftp.stat(Path::new(&remote)).is_ok() {
    return Err("Remote file already exists".into());
  }
  upload_stream(&sftp, &mut source, &remote)?;
  Ok(SSHFileOperationResult {
    canceled: false,
    local_path: None,
    remote_path: Some(remote.clone()),
    path: Some(remote),
    message: None,
  })
}

pub fn download_file(
  sess: ssh2::Session,
  remote_path: &str,
  local_path: &str,
) -> Result<SSHFileOperationResult, String> {
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  download_stream(&sftp, remote_path, Path::new(local_path))?;
  Ok(SSHFileOperationResult {
    canceled: false,
    local_path: None,
    remote_path: Some(local_path.to_string()),
    path: Some(local_path.to_string()),
    message: None,
  })
}

pub fn upload_directory(
  sess: ssh2::Session,
  remote_dir: &str,
  local_path: &str,
) -> Result<SSHFileOperationResult, String> {
  let base = Path::new(local_path);
  let folder_name = base
    .file_name()
    .and_then(|s| s.to_str())
    .ok_or_else(|| "Invalid directory".to_string())?;
  let remote_root = join_remote(remote_dir, folder_name);
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  sftp
    .mkdir(Path::new(&remote_root), 0o755)
    .map_err(|e| e.to_string())?;
  let root = base.canonicalize().map_err(|e| e.to_string())?;
  let mut remaining = MAX_TRANSFER_ENTRIES;
  upload_tree(&sftp, base, &remote_root, &root, &mut remaining, 0)?;
  Ok(SSHFileOperationResult {
    canceled: false,
    local_path: None,
    remote_path: Some(remote_root.clone()),
    path: Some(remote_root),
    message: None,
  })
}

fn upload_tree(sftp: &ssh2::Sftp, local: &Path, remote: &str, root: &Path, remaining: &mut usize, depth: usize) -> Result<(), String> {
  checked_directory(local, root)?;
  for entry in std::fs::read_dir(local).map_err(|e| e.to_string())? {
    visit_entry(remaining, depth)?;
    let entry = entry.map_err(|e| e.to_string())?;
    let name = entry.file_name();
    let name = name.to_string_lossy();
    validate_child_name(&name)?;
    let remote_path = join_remote(remote, &name);
    let ft = entry.file_type().map_err(|e| e.to_string())?;
    if ft.is_dir() {
      sftp
        .mkdir(Path::new(&remote_path), 0o755)
        .map_err(|e| e.to_string())?;
      upload_tree(sftp, &entry.path(), &remote_path, root, remaining, depth + 1)?;
    } else if ft.is_file() {
      let mut source = open_source(&entry.path(), Some(root))?;
      upload_stream(sftp, &mut source, &remote_path)?;
    }
  }
  Ok(())
}

pub fn download_directory(
  sess: ssh2::Session,
  remote_path: &str,
  local_dir: &str,
) -> Result<SSHFileOperationResult, String> {
  let name = Path::new(remote_path)
    .file_name()
    .and_then(|s| s.to_str())
    .unwrap_or("download");
  let dest = Path::new(local_dir).join(name);
  validate_child_name(name)?;
  // A new directory prevents existing symlinks beneath the selected root from redirecting writes.
  std::fs::create_dir(&dest).map_err(|e| format!("Choose a destination without an existing folder of this name: {e}"))?;
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  let root = dest.canonicalize().map_err(|e| e.to_string())?;
  let mut remaining = MAX_TRANSFER_ENTRIES;
  download_tree(&sftp, remote_path, &dest, &root, &mut remaining, 0)?;
  Ok(SSHFileOperationResult {
    canceled: false,
    local_path: None,
    remote_path: Some(dest.to_string_lossy().into()),
    path: Some(dest.to_string_lossy().into()),
    message: None,
  })
}

fn download_tree(sftp: &ssh2::Sftp, remote: &str, local: &Path, root: &Path, remaining: &mut usize, depth: usize) -> Result<(), String> {
  checked_directory(local, root)?;
  let mut directory = sftp.opendir(Path::new(remote)).map_err(|e| e.to_string())?;
  loop {
    let (p, stat) = match directory.readdir() {
      Ok(item) => item,
      Err(e) if e.code() == ssh2::ErrorCode::SFTP(1) => break,
      Err(e) => return Err(e.to_string()),
    };
    visit_entry(remaining, depth)?;
    let name = p
      .file_name()
      .and_then(|s| s.to_str())
      .unwrap_or("")
      .to_string();
    if name == "." || name == ".." {
      continue;
    }
    validate_child_name(&name)?;
    checked_directory(local, root)?;
    let remote_child = join_remote(remote, &name);
    let local_child = local.join(&name);
    if stat.is_dir() {
      std::fs::create_dir(&local_child).map_err(|e| e.to_string())?;
      download_tree(sftp, &remote_child, &local_child, root, remaining, depth + 1)?;
    } else if stat.is_file() {
      download_stream(sftp, &remote_child, &local_child)?;
    }
  }
  Ok(())
}

pub fn upload_entries(
  sess: ssh2::Session,
  remote_dir: &str,
  entries: &[serde_json::Value],
) -> Result<SSHFileOperationResult, String> {
  let sftp = sess.sftp().map_err(|e| e.to_string())?;
  for entry in entries {
    let entry_type = entry.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let relative = entry
      .get("relativePath")
      .and_then(|v| v.as_str())
      .ok_or_else(|| "relativePath required".to_string())?;
    validate_relative_path(relative)?;
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
      let mut source = open_source(Path::new(local), None)?;
      upload_stream(&sftp, &mut source, &remote)?;
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

// Copy in bounded chunks, preserving an existing target when a transfer fails.
fn write_remote_temp(sftp: &ssh2::Sftp, source: &mut impl Read, temporary: &str) -> Result<(), String> {
  let mut output = sftp.open_mode(Path::new(temporary), ssh2::OpenFlags::WRITE | ssh2::OpenFlags::CREATE | ssh2::OpenFlags::EXCLUSIVE, 0o600, ssh2::OpenType::File).map_err(|e| e.to_string())?;
  copy_stream(source, &mut output)?;
  output.flush().map_err(|e| e.to_string())?;
  output.close().map_err(|e| e.to_string())
}
fn upload_stream(sftp: &ssh2::Sftp, source: &mut impl Read, remote: &str) -> Result<(), String> {
  let temp = format!("{remote}.mysql-compare-{}.part", uuid::Uuid::new_v4());
  let result = write_remote_temp(sftp, source, &temp).and_then(|_| {
    sftp.rename(Path::new(&temp), Path::new(remote), Some(ssh2::RenameFlags::ATOMIC | ssh2::RenameFlags::NATIVE)).map_err(|e| e.to_string())
  });
  if result.is_err() { let _ = sftp.unlink(Path::new(&temp)); }
  result
}

fn download_stream(sftp: &ssh2::Sftp, remote: &str, local: &Path) -> Result<(), String> {
  let temp = local.with_file_name(format!(".mysql-compare-{}.part", uuid::Uuid::new_v4()));
  let result = (|| {
    let mut options = std::fs::OpenOptions::new(); options.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut output = options.open(&temp).map_err(|e| e.to_string())?;
    let mut source = sftp.open(Path::new(remote)).map_err(|e| e.to_string())?;
    if !source.stat().map_err(|e| e.to_string())?.is_file() { return Err("Only regular remote files can be downloaded".into()); }
    copy_stream(&mut source, &mut output)?;
    output.sync_all().map_err(|e| e.to_string())?;
    drop(output);
    std::fs::rename(&temp, local).map_err(|e| e.to_string())
  })();
  if result.is_err() { let _ = std::fs::remove_file(&temp); }
  result
}
#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn text_editor_rejects_large_and_binary_files_without_unbounded_reads() {
    let mut source = std::io::repeat(b'a');
    assert!(read_text_bounded(&mut source).unwrap_err().contains("8 MiB"));
    assert!(read_text_bounded(&mut &b"a\0b"[..]).is_err());
    assert_eq!(read_text_bounded(&mut &b"hello"[..]).unwrap(), "hello");
  }
  #[test]
  fn relative_entries_cannot_escape_with_unix_or_windows_path_syntax() {
    for path in ["", "../secret", "/etc/passwd", "a/../../secret", "a\\..\\secret", "C:/secret", "safe:file", "./file", "a/./file", "a\0b"] {
      assert!(validate_relative_path(path).is_err(), "accepted {path:?}");
    }
    assert!(validate_relative_path("folder/中文.txt").is_ok());
    assert!(validate_child_name("folder/file").is_err());
    assert_eq!(normalize_remote("/"), "/");
  }
  #[cfg(unix)]
  #[test]
  fn directory_symlinks_and_non_regular_local_sources_cannot_escape_transfer_root() {
    use std::os::unix::fs::symlink;
    let root = std::env::temp_dir().join(format!("sftp-root-{}", uuid::Uuid::new_v4()));
    let other = std::env::temp_dir().join(format!("sftp-other-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap(); std::fs::create_dir(&other).unwrap();
    std::fs::write(other.join("private"), "private").unwrap();
    symlink(&other, root.join("linked-directory")).unwrap();
    symlink(other.join("private"), root.join("linked-file")).unwrap();
    assert!(checked_directory(&root.join("linked-directory"), &root).is_err());
    assert!(open_source(&root.join("linked-file"), Some(&root)).is_err());
    assert!(open_source(&root, None).is_err());
    assert!(open_source(&other.join("private"), Some(&root)).is_err());
    std::fs::remove_dir_all(root).unwrap(); std::fs::remove_dir_all(other).unwrap();
  }
  #[test]
  fn transfer_copy_is_streamed_and_traversals_have_limits() {
    let mut copied = Vec::new(); copy_stream(&mut &b"small file"[..], &mut copied).unwrap();
    assert_eq!(copied, b"small file");
    let mut remaining = 1;
    visit_entry(&mut remaining, 1).unwrap();
    assert!(visit_entry(&mut remaining, 1).is_err());
    assert!(visit_entry(&mut 1, MAX_TRANSFER_DEPTH + 1).is_err());
  }
}
