pub mod host_verify;
pub mod sftp;
pub mod terminal;
pub mod tunnel;

use crate::types::ConnectionConfig;

pub fn ssh_auth_ok(conn: &ConnectionConfig) -> Result<(), String> {
  let has_key = conn
    .ssh_private_key
    .as_deref()
    .map(|s| !s.trim().is_empty())
    .unwrap_or(false)
    || conn
      .ssh_private_key_path
      .as_deref()
      .map(|s| !s.trim().is_empty())
      .unwrap_or(false);
  let has_password = conn
    .ssh_password
    .as_deref()
    .map(|s| !s.trim().is_empty())
    .unwrap_or(false);
  if !has_key && !has_password {
    return Err("SSH requires password or private key".into());
  }
  Ok(())
}
