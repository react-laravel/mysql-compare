use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;

use parking_lot::Mutex;
use ssh2::{Channel, Session};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::ssh::tunnel::connect_session;
use crate::store::host_keys::HostKeyStore;
use crate::types::{
  ConnectionConfig, SSHTerminalCreateResult, SSHTerminalDataEvent, SSHTerminalExitEvent,
};

struct TerminalSession {
  session: Session,
  channel: Channel,
}

pub struct TerminalManager {
  sessions: Mutex<HashMap<String, Arc<Mutex<TerminalSession>>>>,
}

impl TerminalManager {
  pub fn new() -> Self {
    Self {
      sessions: Mutex::new(HashMap::new()),
    }
  }

  pub fn create(
    &self,
    app: &AppHandle,
    host_keys: &HostKeyStore,
    conn: &ConnectionConfig,
    cols: u32,
    rows: u32,
  ) -> Result<SSHTerminalCreateResult, String> {
    let sess = connect_session(conn, host_keys, app)?;
    let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
    let cols = cols.clamp(2, 500);
    let rows = rows.clamp(2, 500);
    channel
      .request_pty_size(cols, rows, Some(cols * 8), Some(rows * 16))
      .ok();
    channel
      .request_pty("xterm-256color", None, None)
      .map_err(|e| e.to_string())?;
    channel.shell().map_err(|e| e.to_string())?;
    sess.set_blocking(false);

    let session_id = Uuid::new_v4().to_string();
    let shared = Arc::new(Mutex::new(TerminalSession {
      session: sess,
      channel,
    }));
    self
      .sessions
      .lock()
      .insert(session_id.clone(), shared.clone());

    let app2 = app.clone();
    let sid = session_id.clone();
    thread::spawn(move || {
      let mut buf = [0u8; 4096];
      loop {
        let read_result = {
          let mut guard = shared.lock();
          guard.channel.read(&mut buf)
        };
        match read_result {
          Ok(0) => {
            let _ = app2.emit(
              "ssh-terminal:exit",
              SSHTerminalExitEvent {
                session_id: sid.clone(),
                message: Some("session closed".into()),
              },
            );
            break;
          }
          Ok(n) => {
            let data = String::from_utf8_lossy(&buf[..n]).to_string();
            let _ = app2.emit(
              "ssh-terminal:data",
              SSHTerminalDataEvent {
                session_id: sid.clone(),
                data,
              },
            );
          }
          Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
            thread::sleep(std::time::Duration::from_millis(20));
          }
          Err(_) => {
            let _ = app2.emit(
              "ssh-terminal:exit",
              SSHTerminalExitEvent {
                session_id: sid.clone(),
                message: Some("read error".into()),
              },
            );
            break;
          }
        }
      }
    });

    Ok(SSHTerminalCreateResult { session_id })
  }

  pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
    let session = {
      let sessions = self.sessions.lock();
      sessions
        .get(session_id)
        .cloned()
        .ok_or_else(|| "Terminal session not found".to_string())?
    };
    // 会话是非阻塞的，write_all 遇到 WouldBlock 会中途失败；
    // 手动循环重试，且每次重试间释放锁，避免饿死读线程。
    let bytes = data.as_bytes();
    let mut written = 0;
    while written < bytes.len() {
      let write_result = {
        let mut guard = session.lock();
        guard.channel.write(&bytes[written..])
      };
      match write_result {
        Ok(0) => return Err("Terminal channel closed".into()),
        Ok(n) => written += n,
        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
          thread::sleep(std::time::Duration::from_millis(5));
        }
        Err(e) => return Err(e.to_string()),
      }
    }
    let mut guard = session.lock();
    let _ = guard.channel.flush();
    Ok(())
  }

  pub fn resize(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
    let cols = cols.clamp(2, 500);
    let rows = rows.clamp(2, 500);
    let sessions = self.sessions.lock();
    let session = sessions
      .get(session_id)
      .ok_or_else(|| "Terminal session not found".to_string())?;
    let mut guard = session.lock();
    guard
      .channel
      .request_pty_size(cols, rows, Some(cols * 8), Some(rows * 16))
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn close(&self, session_id: &str) -> Result<(), String> {
    if let Some(session) = self.sessions.lock().remove(session_id) {
      let mut guard = session.lock();
      let _ = guard.channel.close();
      let _ = guard.session.disconnect(None, "", None);
    }
    Ok(())
  }
}
