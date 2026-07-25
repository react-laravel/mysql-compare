use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use ssh2::Session;
use tauri::AppHandle;

use crate::ssh::host_verify::verify_host_key;
use crate::ssh::ssh_auth_ok;
use crate::store::host_keys::HostKeyStore;
use crate::types::{ConnectionConfig, DbEngine};

pub struct TunnelManager {
  tunnels: Mutex<std::collections::HashMap<String, u16>>,
}

impl TunnelManager {
  pub fn new() -> Self {
    Self {
      tunnels: Mutex::new(std::collections::HashMap::new()),
    }
  }

  pub fn ensure(
    &self,
    app: &AppHandle,
    host_keys: &HostKeyStore,
    conn: &ConnectionConfig,
  ) -> Result<u16, String> {
    if let Some(port) = self.tunnels.lock().get(&conn.id).copied() {
      return Ok(port);
    }
    let port = spawn_tunnel(app, host_keys, conn)?;
    self.tunnels.lock().insert(conn.id.clone(), port);
    Ok(port)
  }

  pub fn close(&self, connection_id: &str) {
    self.tunnels.lock().remove(connection_id);
  }
}

fn spawn_tunnel(
  app: &AppHandle,
  host_keys: &HostKeyStore,
  conn: &ConnectionConfig,
) -> Result<u16, String> {
  let mut probe_session = connect_session(conn, host_keys, app)?;
  probe_remote_database(&mut probe_session, conn)?;

  let ssh_host = conn.ssh_host.clone().unwrap();
  let ssh_port = conn.ssh_port.unwrap_or(22);
  let remote_host = conn.host.clone();
  let remote_port = conn.port;
  let conn = conn.clone();

  let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
  let local_port = listener.local_addr().map_err(|e| e.to_string())?.port();

  thread::spawn(move || {
    for stream in listener.incoming() {
      let Ok(mut client) = stream else { continue };
      if client.set_nonblocking(true).is_err() {
        continue;
      }
      let _ = client.set_nodelay(true);
      let ssh_host = ssh_host.clone();
      let conn = conn.clone();
      let remote_host = remote_host.clone();
      thread::spawn(move || {
        let Ok(tcp) = TcpStream::connect(format!("{ssh_host}:{ssh_port}")) else {
          return;
        };
        let Ok(mut sess) = Session::new() else {
          return;
        };
        sess.set_tcp_stream(tcp);
        if sess.handshake().is_err() {
          return;
        }
        if authenticate(&mut sess, &conn).is_err() {
          return;
        }
        let Ok(mut channel) = sess.channel_direct_tcpip(&remote_host, remote_port, None) else {
          return;
        };
        sess.set_blocking(false);
        let mut buf_c = [0u8; 8192];
        let mut buf_s = [0u8; 8192];
        let mut pending_to_channel = Vec::new();
        let mut pending_to_client = Vec::new();
        let mut client_eof = false;
        let mut channel_eof = false;
        let mut channel_eof_sent = false;
        loop {
          let mut progress = false;

          if pending_to_channel.is_empty() && !client_eof {
            match client.read(&mut buf_c) {
              Ok(0) => client_eof = true,
              Ok(n) => {
                pending_to_channel.extend_from_slice(&buf_c[..n]);
                progress = true;
              }
              Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
              Err(_) => break,
            }
          }

          if !pending_to_channel.is_empty() {
            match channel.write(&pending_to_channel) {
              Ok(0) => break,
              Ok(n) => {
                pending_to_channel.drain(..n);
                progress = true;
              }
              Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
              Err(_) => break,
            }
          }

          if client_eof && pending_to_channel.is_empty() && !channel_eof_sent {
            if channel.send_eof().is_ok() {
              channel_eof_sent = true;
              progress = true;
            }
          }

          if pending_to_client.is_empty() && !channel_eof {
            match channel.read(&mut buf_s) {
              Ok(0) => channel_eof = true,
              Ok(n) => {
                pending_to_client.extend_from_slice(&buf_s[..n]);
                progress = true;
              }
              Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
              Err(_) => break,
            }
          }

          if !pending_to_client.is_empty() {
            match client.write(&pending_to_client) {
              Ok(0) => break,
              Ok(n) => {
                pending_to_client.drain(..n);
                progress = true;
              }
              Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
              Err(_) => break,
            }
          }

          if client_eof
            && channel_eof
            && pending_to_channel.is_empty()
            && pending_to_client.is_empty()
          {
            break;
          }

          if !progress {
            thread::sleep(Duration::from_millis(5));
          }
        }
      });
    }
  });

  thread::sleep(Duration::from_millis(20));
  Ok(local_port)
}

fn probe_remote_database(sess: &mut Session, conn: &ConnectionConfig) -> Result<(), String> {
  let remote = format!("{}:{}", conn.host, conn.port);
  sess.set_timeout(5_000);
  let mut channel = sess
    .channel_direct_tcpip(&conn.host, conn.port, None)
    .map_err(|e| {
      format!(
        "SSH connected, but the database endpoint {remote} is unreachable from the SSH server: {e}. \
Check that the database service is running, listening on this address and port, and allowed by the firewall."
      )
    })?;

  if conn.engine == DbEngine::Mysql {
    let mut prefix = [0u8; 5];
    channel.read_exact(&mut prefix).map_err(|e| {
      format!(
        "SSH can open {remote}, but the service closed or did not send a MySQL handshake: {e}. \
Check that MySQL is running on this port."
      )
    })?;
    validate_mysql_handshake_prefix(&prefix).map_err(|reason| {
      format!(
        "SSH can open {remote}, but the service on this port does not appear to be MySQL: {reason}."
      )
    })?;
  }

  let _ = channel.close();
  Ok(())
}

fn validate_mysql_handshake_prefix(prefix: &[u8; 5]) -> Result<(), String> {
  let payload_length =
    usize::from(prefix[0]) | (usize::from(prefix[1]) << 8) | (usize::from(prefix[2]) << 16);
  if payload_length == 0 {
    return Err("empty handshake packet".into());
  }
  if prefix[3] != 0 {
    return Err(format!("unexpected packet sequence {}", prefix[3]));
  }
  if prefix[4] != 0x0a && prefix[4] != 0xff {
    return Err(format!("unexpected protocol marker 0x{:02x}", prefix[4]));
  }
  Ok(())
}

pub fn authenticate(sess: &mut Session, conn: &ConnectionConfig) -> Result<(), String> {
  let user = conn
    .ssh_username
    .as_deref()
    .ok_or_else(|| "sshUsername required".to_string())?;
  if let Some(key) = conn.ssh_private_key.as_deref().filter(|s| !s.trim().is_empty()) {
    let passphrase = conn.ssh_passphrase.as_deref();
    sess
      .userauth_pubkey_memory(user, None, key, passphrase)
      .map_err(|e| format!("SSH key auth failed: {e}"))?;
  } else if let Some(path) = conn
    .ssh_private_key_path
    .as_deref()
    .filter(|s| !s.trim().is_empty())
  {
    let passphrase = conn.ssh_passphrase.as_deref();
    sess
      .userauth_pubkey_file(user, None, std::path::Path::new(path), passphrase)
      .map_err(|e| format!("SSH key file auth failed: {e}"))?;
  } else if let Some(password) = conn.ssh_password.as_deref() {
    sess
      .userauth_password(user, password)
      .map_err(|e| format!("SSH password auth failed: {e}"))?;
  } else {
    return Err("SSH requires password or private key".into());
  }
  if !sess.authenticated() {
    return Err("SSH authentication failed".into());
  }
  Ok(())
}

pub fn connect_session(
  conn: &ConnectionConfig,
  host_keys: &HostKeyStore,
  app: &AppHandle,
) -> Result<Session, String> {
  ssh_auth_ok(conn)?;
  let ssh_host = conn.ssh_host.clone().ok_or("sshHost required")?;
  let ssh_port = conn.ssh_port.unwrap_or(22);
  let tcp = TcpStream::connect(format!("{ssh_host}:{ssh_port}"))
    .map_err(|e| format!("SSH connect failed: {e}"))?;
  let mut sess = Session::new().map_err(|e| e.to_string())?;
  sess.set_tcp_stream(tcp);
  sess.handshake().map_err(|e| e.to_string())?;
  let host_key = sess.host_key().ok_or("missing SSH host key")?;
  verify_host_key(app, host_keys, &ssh_host, ssh_port, host_key.0)?;
  authenticate(&mut sess, conn)?;
  Ok(sess)
}

#[cfg(test)]
mod tests {
  use super::validate_mysql_handshake_prefix;

  #[test]
  fn recognizes_mysql_handshake_prefixes() {
    assert!(validate_mysql_handshake_prefix(&[0x4a, 0, 0, 0, 0x0a]).is_ok());
    assert!(validate_mysql_handshake_prefix(&[0x20, 0, 0, 0, 0xff]).is_ok());
  }

  #[test]
  fn rejects_empty_or_non_mysql_handshake_prefixes() {
    assert_eq!(
      validate_mysql_handshake_prefix(&[0, 0, 0, 0, 0x0a]).unwrap_err(),
      "empty handshake packet"
    );
    assert_eq!(
      validate_mysql_handshake_prefix(&[4, 0, 0, 0, b'S']).unwrap_err(),
      "unexpected protocol marker 0x53"
    );
  }
}
