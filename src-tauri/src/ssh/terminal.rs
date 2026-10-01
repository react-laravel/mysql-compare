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

#[derive(Clone)]
pub struct TerminalManager {
  sessions: Arc<Mutex<HashMap<String, Arc<Mutex<TerminalSession>>>>>,
}

impl TerminalManager {
  pub fn new() -> Self {
    Self {
      sessions: Arc::new(Mutex::new(HashMap::new())),
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
    let sessions = self.sessions.clone();
    thread::spawn(move || {
      let mut text = Utf8Stream::default();
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
            let data = text.push(&buf[..n]);
            let _ = app2.emit(
              "ssh-terminal:data",
              SSHTerminalDataEvent {
                session_id: sid.clone(),
                data,
              },
            );
          }
          Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
            wait_for_socket(&shared);
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
      sessions.lock().remove(&sid);
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

// Idle terminals wait for kernel socket readiness, with a bounded wakeup for shutdown.
fn wait_for_socket(shared: &Mutex<TerminalSession>) {
  #[cfg(unix)] {
    use std::os::fd::AsRawFd;
    let (fd, events) = {
      let session=shared.lock();
      let events=match session.session.block_directions() {
        ssh2::BlockDirections::Outbound => libc::POLLOUT,
        ssh2::BlockDirections::Both => libc::POLLIN | libc::POLLOUT,
        _ => libc::POLLIN,
      };
      (session.session.as_raw_fd(), events)
    };
    let mut descriptor=libc::pollfd {fd,events,revents:0};
    // Session remains owned by the reader's Arc while poll uses its socket FD.
    unsafe { libc::poll(&mut descriptor, 1, 500); }
  }
  #[cfg(not(unix))] { let _=shared; thread::sleep(std::time::Duration::from_millis(100)); }
}
#[derive(Default)]
struct Utf8Stream(Vec<u8>);
impl Utf8Stream {
  fn push(&mut self, bytes:&[u8])->String {
    self.0.extend_from_slice(bytes); let mut text=String::new();
    loop {
      match std::str::from_utf8(&self.0) {
        Ok(valid)=>{ text.push_str(valid); self.0.clear(); break; }
        Err(error)=>{
          let valid=error.valid_up_to();
          text.push_str(std::str::from_utf8(&self.0[..valid]).unwrap());
          if let Some(invalid)=error.error_len() {text.push('�'); self.0.drain(..valid+invalid);}
          else {self.0.drain(..valid); break;}
        }
      }
    }
    text
  }
}
#[cfg(test)] mod tests {
  use super::*;
  #[test] fn streaming_multibyte_terminal_output_preserves_split_characters() {
    let mut stream=Utf8Stream::default(); let bytes="你好🦀".as_bytes(); let mut text=String::new();
    for byte in bytes {text.push_str(&stream.push(&[*byte]));}
    assert_eq!(text,"你好🦀");
    assert_eq!(stream.push(&[0xff]),"�");
  }
}
