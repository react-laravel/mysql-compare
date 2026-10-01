use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Weak};
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use ssh2::Session;
use tauri::AppHandle;

use crate::ssh::host_verify::{fingerprint_sha256, verify_host_key};
use crate::ssh::ssh_auth_ok;
use crate::store::host_keys::HostKeyStore;
use crate::types::{ConnectionConfig, DbEngine};

struct TunnelHandle {
  port: u16,
  shutdown: Arc<AtomicBool>,
  host_key_error: Arc<Mutex<Option<String>>>,
}

struct Connecting { lock: Mutex<()>, generation: AtomicU64 }
#[derive(Clone)]
pub struct TunnelManager {
  tunnels: Arc<Mutex<std::collections::HashMap<String, TunnelHandle>>>,
  connecting: Arc<Mutex<std::collections::HashMap<String, Weak<Connecting>>>>,
}

impl TunnelManager {
  pub fn new() -> Self {
    Self {
      tunnels: Arc::new(Mutex::new(std::collections::HashMap::new())),
      connecting: Arc::new(Mutex::new(std::collections::HashMap::new())),
    }
  }

  pub fn ensure(
    &self,
    app: &AppHandle,
    host_keys: &HostKeyStore,
    conn: &ConnectionConfig,
  ) -> Result<u16, String> {
    let connecting = {
      let mut pending = self.connecting.lock();
      pending.retain(|_, weak| weak.strong_count() > 0);
      if let Some(connecting) = pending.get(&conn.id).and_then(Weak::upgrade) { connecting }
      else {
        let connecting = Arc::new(Connecting { lock: Mutex::new(()), generation: AtomicU64::new(0) });
        pending.insert(conn.id.clone(), Arc::downgrade(&connecting));
        connecting
      }
    };
    // Serialize creation for this connection only, so concurrent tabs share
    // one listener without holding the manager's global lock during network I/O.
    let _creation = connecting.lock.lock();
    crate::operations::check()?;
    let generation = connecting.generation.load(Ordering::SeqCst);
    if let Some(handle) = self.tunnels.lock().get(&conn.id) {
      return Ok(handle.port);
    }
    let handle = spawn_tunnel(app, host_keys, conn)?;
    let port = handle.port;
    let mut tunnels = self.tunnels.lock();
    if generation != connecting.generation.load(Ordering::SeqCst) {
      handle.shutdown.store(true, Ordering::Relaxed);
      return Err("SSH connection was closed or changed while connecting".into());
    }
    tunnels.insert(conn.id.clone(), handle);
    Ok(port)
  }

  pub fn close(&self, connection_id: &str) {
    if let Some(connecting) = self.connecting.lock().get(connection_id).and_then(Weak::upgrade) {
      connecting.generation.fetch_add(1, Ordering::SeqCst);
    }
    if let Some(handle) = self.tunnels.lock().remove(connection_id) {
      handle.shutdown.store(true, Ordering::Relaxed);
    }
  }
  pub fn host_key_error(&self, connection_id: &str) -> Option<String> {
    self.tunnels.lock().get(connection_id).and_then(|handle| handle.host_key_error.lock().clone())
  }
}

fn spawn_tunnel(
  app: &AppHandle,
  host_keys: &HostKeyStore,
  conn: &ConnectionConfig,
) -> Result<TunnelHandle, String> {
  let probe_session = connect_session(conn, host_keys, app)?;
  spawn_tunnel_with_session(conn, probe_session)
}

fn spawn_tunnel_with_session(
  conn: &ConnectionConfig,
  mut probe_session: Session,
) -> Result<TunnelHandle, String> {
  crate::operations::check()?;
  probe_remote_database(&mut probe_session, conn)?;
  crate::operations::check()?;
  // Pin the verified key for this tunnel. Every independent forwarding session
  // must prove the same host identity before receiving any credentials.
  let verified_host_key = Arc::new(
    probe_session
      .host_key()
      .ok_or("missing SSH host key")?
      .0
      .to_vec(),
  );
  let remote_host = conn.host.clone();
  let remote_port = conn.port;
  let conn = conn.clone();

  let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
  let local_port = listener.local_addr().map_err(|e| e.to_string())?.port();
  listener.set_nonblocking(true).map_err(|e| e.to_string())?;
  let shutdown = Arc::new(AtomicBool::new(false));
  let shutdown_flag = shutdown.clone();
  let host_key_error = Arc::new(Mutex::new(None));
  let reported_error = host_key_error.clone();

  thread::spawn(move || {
    loop {
      if shutdown_flag.load(Ordering::Relaxed) {
        break;
      }
      let mut client = match listener.accept() {
        Ok((stream, _)) => stream,
        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
          thread::sleep(Duration::from_millis(50));
          continue;
        }
        Err(_) => break,
      };
      if client.set_nonblocking(true).is_err() {
        continue;
      }
      let _ = client.set_nodelay(true);
      let verified_host_key = verified_host_key.clone();
      let conn = conn.clone();
      let remote_host = remote_host.clone();
      let reported_error = reported_error.clone();
      thread::spawn(move || {
        let sess = match connect_forward_session(&conn, &verified_host_key) {
          Ok(sess) => sess,
          Err(error) => {
            if error.starts_with("SSH host key mismatch") {
              *reported_error.lock() = Some(format!("{error}. Close this connection and reconnect to verify the current SSH fingerprint. / 请关闭此连接并重新连接，以核对此主机当前的 SSH 指纹。"));
            }
            log::warn!("SSH forwarding connection rejected: {error}");
            return;
          }
        };
        *reported_error.lock() = None;
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
  Ok(TunnelHandle {
    port: local_port,
    shutdown,
    host_key_error,
  })
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
  connect_session_with_verifier(conn, |host, port, key| {
    verify_host_key(app, host_keys, host, port, key)
  })
}

fn connect_forward_session(
  conn: &ConnectionConfig,
  verified_host_key: &[u8],
) -> Result<Session, String> {
  connect_session_with_verifier(conn, |host, port, key| {
    if key != verified_host_key {
      return Err(format!(
        "SSH host key mismatch for {host}:{port}. Expected {}, got {}",
        fingerprint_sha256(verified_host_key),
        fingerprint_sha256(key)
      ));
    }
    Ok(())
  })
}

fn connect_session_with_verifier(
  conn: &ConnectionConfig,
  verify: impl FnOnce(&str, u16, &[u8]) -> Result<(), String>,
) -> Result<Session, String> {
  ssh_auth_ok(conn)?;
  crate::operations::check()?;
  let ssh_host = conn.ssh_host.clone().ok_or("sshHost required")?;
  let ssh_port = conn.ssh_port.unwrap_or(22);
  let deadline = Instant::now() + Duration::from_secs(15);
  let addresses = (ssh_host.as_str(), ssh_port).to_socket_addrs().map_err(|e| format!("SSH address resolution failed: {e}"))?;
  let mut tcp = None;
  let mut last_error = "No SSH address was resolved".to_string();
  for address in addresses {
    crate::operations::check()?;
    let remaining = deadline.checked_duration_since(Instant::now()).filter(|remaining| !remaining.is_zero()).ok_or("SSH connection timed out after 15 seconds")?;
    match TcpStream::connect_timeout(&address, remaining) {
      Ok(stream) => { tcp = Some(stream); break; },
      Err(error) => last_error = error.to_string(),
    }
  }
  let tcp = tcp.ok_or_else(|| format!("SSH connect failed: {last_error}"))?;
  crate::operations::check()?;
  let mut sess = Session::new().map_err(|e| e.to_string())?;
  // Bound libssh2 handshake, authentication and each blocking SFTP request.
  // Streaming large files still works as a sequence of bounded requests.
  let handshake_timeout = deadline.checked_duration_since(Instant::now()).filter(|remaining| !remaining.is_zero()).ok_or("SSH connection timed out after 15 seconds")?;
  sess.set_timeout(handshake_timeout.as_millis().max(1).min(u32::MAX as u128) as u32);
  sess.set_tcp_stream(tcp);
  sess.handshake().map_err(|e| e.to_string())?;
  crate::operations::check()?;
  let host_key = sess.host_key().ok_or("missing SSH host key")?;
  verify(&ssh_host, ssh_port, host_key.0)?;
  crate::operations::check()?;
  let authentication_timeout = deadline.checked_duration_since(Instant::now()).filter(|remaining| !remaining.is_zero()).ok_or("SSH connection timed out after 15 seconds")?;
  sess.set_timeout(authentication_timeout.as_millis().max(1).min(u32::MAX as u128) as u32);
  authenticate(&mut sess, conn)?;
  crate::operations::check()?;
  sess.set_timeout(30_000);
  Ok(sess)
}

#[cfg(all(test, unix))]
#[path = "tunnel_host_key_tests.rs"]
mod host_key_tests;

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
