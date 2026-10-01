//! Real SSH regressions. Unix test hosts need OpenSSH sshd and ssh-keygen.
//! All keys are generated in a temporary directory; sockets use loopback only.

use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::fd::OwnedFd;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use base64::Engine;
use parking_lot::Mutex;

use super::{connect_forward_session, connect_session_with_verifier, spawn_tunnel_with_session};
use crate::types::ConnectionConfig;
use crate::store::host_keys::{HostKeyChallenge, HostKeyStore, CHALLENGE_PREFIX};

const GREETING: [u8; 5] = [0x4a, 0, 0, 0, 0x0a];

struct SshFixture {
  dir: PathBuf,
  conn: ConnectionConfig,
  trusted_key: Vec<u8>,
  changed_key: Arc<AtomicBool>,
  database_connections: Arc<AtomicUsize>,
  shutdown: Arc<AtomicBool>,
  workers: Vec<JoinHandle<()>>,
  children: Arc<Mutex<Vec<Child>>>,
}

impl SshFixture {
  fn new() -> Self {
    Self::with_sftp("internal-sftp")
  }
  fn with_sftp(sftp_subsystem: &str) -> Self {
    let dir = std::env::temp_dir().join(format!("mysql-compare-ssh-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&dir).unwrap();
    for name in ["trusted-host", "changed-host", "client"] {
      let mut command = Command::new("ssh-keygen");
      command.args(["-q", "-N", "", "-C", "mysql-compare-test"]);
      if name == "client" {
        command.args(["-t", "rsa", "-b", "2048", "-m", "PEM"]);
      } else {
        command.args(["-t", "ed25519"]);
      }
      assert!(command
        .arg("-f")
        .arg(dir.join(name))
        .status()
        .unwrap()
        .success());
    }
    let public_key = fs::read_to_string(dir.join("trusted-host.pub")).unwrap();
    let trusted_key = base64::engine::general_purpose::STANDARD
      .decode(public_key.split_whitespace().nth(1).unwrap())
      .unwrap();
    let username = Command::new("id").arg("-un").output().unwrap();
    assert!(username.status.success());

    let database = TcpListener::bind("127.0.0.1:0").unwrap();
    database.set_nonblocking(true).unwrap();
    let database_port = database.local_addr().unwrap().port();
    let ssh = TcpListener::bind("127.0.0.1:0").unwrap();
    ssh.set_nonblocking(true).unwrap();
    let ssh_port = ssh.local_addr().unwrap().port();
    fs::write(
      dir.join("sshd_config"),
      format!(
        "UsePAM no\nStrictModes no\nPasswordAuthentication no\n\
         KbdInteractiveAuthentication no\nAuthorizedKeysFile \"{}\"\n\
         AllowTcpForwarding local\nPermitOpen 127.0.0.1:{database_port}\n\
         Subsystem sftp {sftp_subsystem}\nMaxSessions 1\nLoginGraceTime 5\nLogLevel DEBUG1\n",
        dir.join("client.pub").display()
      ),
    )
    .unwrap();
    let conn = serde_json::from_value(serde_json::json!({
      "id": "host-key-regression", "name": "host-key-regression", "engine": "mysql",
      "host": "127.0.0.1", "port": database_port, "username": "test", "useSSH": true,
      "sshHost": "127.0.0.1", "sshPort": ssh_port,
      "sshUsername": String::from_utf8(username.stdout).unwrap().trim(),
      "sshPrivateKeyPath": dir.join("client"), "createdAt": 0, "updatedAt": 0,
    }))
    .unwrap();
    let mut fixture = Self {
      dir,
      conn,
      trusted_key,
      changed_key: Arc::new(AtomicBool::new(false)),
      database_connections: Arc::new(AtomicUsize::new(0)),
      shutdown: Arc::new(AtomicBool::new(false)),
      workers: Vec::new(),
      children: Arc::new(Mutex::new(Vec::new())),
    };

    let shutdown = fixture.shutdown.clone();
    let connections = fixture.database_connections.clone();
    fixture.workers.push(thread::spawn(move || {
      while !shutdown.load(Ordering::SeqCst) {
        match database.accept() {
          Ok((mut stream, _)) => {
            stream.set_nonblocking(false).unwrap();
            connections.fetch_add(1, Ordering::SeqCst);
            thread::spawn(move || {
              stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
              stream
                .set_write_timeout(Some(Duration::from_secs(5)))
                .unwrap();
              if stream.write_all(&GREETING).is_ok() {
                let mut data = [0; 64];
                while let Ok(n) = stream.read(&mut data) {
                  if n == 0 || stream.write_all(&data[..n]).is_err() {
                    break;
                  }
                }
              }
            });
          }
          Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
            thread::sleep(Duration::from_millis(10));
          }
          Err(error) => panic!("test database accept: {error}"),
        }
      }
    }));

    let shutdown = fixture.shutdown.clone();
    let changed_key = fixture.changed_key.clone();
    let children = fixture.children.clone();
    let dir = fixture.dir.clone();
    fixture.workers.push(thread::spawn(move || {
      while !shutdown.load(Ordering::SeqCst) {
        match ssh.accept() {
          Ok((stream, _)) => {
            stream.set_nonblocking(false).unwrap();
            let key = if changed_key.load(Ordering::SeqCst) {
              "changed-host"
            } else {
              "trusted-host"
            };
            let mut children = children.lock();
            let log =
              fs::File::create(dir.join(format!("connection-{}.log", children.len()))).unwrap();
            // Inetd mode serves exactly this accepted socket and opens no SSH listener.
            let child = Command::new("/usr/sbin/sshd")
              .args(["-i", "-e", "-f"])
              .arg(dir.join("sshd_config"))
              .arg("-h")
              .arg(dir.join(key))
              .stdin(Stdio::from(OwnedFd::from(stream.try_clone().unwrap())))
              .stdout(Stdio::from(OwnedFd::from(stream)))
              .stderr(log)
              .spawn()
              .expect("OpenSSH sshd is required for SSH host-key regression tests");
            children.push(child);
          }
          Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
            thread::sleep(Duration::from_millis(10));
          }
          Err(error) => panic!("test SSH accept: {error}"),
        }
      }
    }));
    fixture
  }

  fn completed_log(&self, index: usize) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
      if let Some(child) = self.children.lock().get_mut(index) {
        if child.try_wait().unwrap().is_some() {
          return fs::read_to_string(self.dir.join(format!("connection-{index}.log"))).unwrap();
        }
      }
      assert!(
        Instant::now() < deadline,
        "SSH test connection {index} did not finish"
      );
      thread::sleep(Duration::from_millis(10));
    }
  }
}

impl Drop for SshFixture {
  fn drop(&mut self) {
    self.shutdown.store(true, Ordering::SeqCst);
    for worker in self.workers.drain(..) {
      let _ = worker.join();
    }
    for child in self.children.lock().iter_mut() {
      let _ = child.kill();
      let _ = child.wait();
    }
    let _ = fs::remove_dir_all(&self.dir);
  }
}

fn assert_no_authentication_or_forwarding(log: &str) {
  assert!(
    log.contains("SSH2_MSG_NEWKEYS received"),
    "handshake did not finish: {log}"
  );
  assert!(
    !log.contains("userauth-request"),
    "credentials sent before key verification: {log}"
  );
  assert!(
    !log.contains("direct-tcpip"),
    "forwarding opened before key verification: {log}"
  );
}

#[test]
fn first_seen_host_requires_confirmation_before_authentication_then_retries_safely() {
  let fixture = SshFixture::new();
  let store = HostKeyStore::load_path(fixture.dir.join("ssh-host-keys.json")).unwrap();
  let error = connect_session_with_verifier(&fixture.conn, |host, port, key| {
    store.verify(host, port, &super::fingerprint_sha256(key))
  }).err().expect("unknown SSH identity must not receive credentials");
  let challenge: HostKeyChallenge = serde_json::from_str(error.strip_prefix(CHALLENGE_PREFIX).expect("structured confirmation challenge")).unwrap();
  assert_eq!(challenge.fingerprint, super::fingerprint_sha256(&fixture.trusted_key));
  assert_no_authentication_or_forwarding(&fixture.completed_log(0));
  assert_eq!(fixture.database_connections.load(Ordering::SeqCst), 0);
  assert!(!fixture.dir.join("ssh-host-keys.json").exists());
  store.confirm(&challenge.challenge_id, &challenge.fingerprint).unwrap();
  let session = connect_session_with_verifier(&fixture.conn, |host, port, key| {
    store.verify(host, port, &super::fingerprint_sha256(key))
  }).expect("confirmed host authenticates on retry");
  assert!(session.authenticated());
  drop(session);
  assert!(fixture.completed_log(1).contains("Accepted publickey"));
  assert_eq!(fixture.database_connections.load(Ordering::SeqCst), 0);
}

#[test]
fn cancellation_after_verified_handshake_stops_before_authentication_or_forwarding() {
  let fixture = SshFixture::new();
  let cancellation = crate::operations::Cancellation::new();
  let error = crate::operations::with_cancellation(Some(cancellation.clone()), || {
    connect_session_with_verifier(&fixture.conn, |_, _, key| {
      assert_eq!(key, fixture.trusted_key);
      // Simulate the UI cancel arriving immediately after host verification.
      cancellation.cancel();
      Ok(())
    })
  }).err().expect("cancellation must prevent credential authentication");
  assert!(error.contains("canceled"));
  assert_no_authentication_or_forwarding(&fixture.completed_log(0));
  assert_eq!(fixture.database_connections.load(Ordering::SeqCst), 0);
}

#[test]
fn sftp_streams_large_files_without_editor_loading_and_preserves_existing_targets() {
  use std::os::unix::fs::PermissionsExt;
  use sha2::{Digest, Sha256};
  use crate::ssh::sftp;
  let fixture = SshFixture::new();
  let session = || connect_session_with_verifier(&fixture.conn, |_, _, key| {
    assert_eq!(key, fixture.trusted_key);
    Ok(())
  }).expect("authenticate disposable SFTP session with its verified key");
  let remote_directory = fixture.dir.join("remote-transfer");
  fs::create_dir(&remote_directory).unwrap();
  let source = fixture.dir.join("large-file.txt");
  let bytes = vec![b'x'; 10 * 1024 * 1024 + 123];
  fs::write(&source, &bytes).unwrap();
  let remote_file = remote_directory.join("large-file.txt");
  sftp::upload_file(session(), remote_directory.to_str().unwrap(), source.to_str().unwrap()).unwrap();
  assert_eq!(Sha256::digest(fs::read(&remote_file).unwrap()), Sha256::digest(&bytes));
  assert!(sftp::read_file_with_session(session(), remote_file.to_str().unwrap()).unwrap_err().contains("8 MiB"));
  let downloaded = fixture.dir.join("downloaded.txt");
  sftp::download_file(session(), remote_file.to_str().unwrap(), downloaded.to_str().unwrap()).unwrap();
  assert_eq!(Sha256::digest(fs::read(&downloaded).unwrap()), Sha256::digest(&bytes));

  fs::write(&source, b"must not overwrite the uploaded file").unwrap();
  assert!(sftp::upload_file(session(), remote_directory.to_str().unwrap(), source.to_str().unwrap()).is_err());
  assert_eq!(Sha256::digest(fs::read(&remote_file).unwrap()), Sha256::digest(&bytes));

  let editor_file = remote_directory.join("editor.txt");
  fs::write(&editor_file, b"original").unwrap();
  fs::set_permissions(&editor_file, fs::Permissions::from_mode(0o755)).unwrap();
  sftp::write_file_with_session(session(), editor_file.to_str().unwrap(), "updated 中文").unwrap();
  assert_eq!(fs::read_to_string(&editor_file).unwrap(), "updated 中文");
  assert_eq!(fs::metadata(&editor_file).unwrap().permissions().mode() & 0o7777, 0o755);
  assert_eq!(sftp::read_file_with_session(session(), editor_file.to_str().unwrap()).unwrap().content, "updated 中文");
  assert!(sftp::write_file_with_session(session(), editor_file.to_str().unwrap(), std::str::from_utf8(&bytes).unwrap()).is_err());
  assert_eq!(fs::read_to_string(&editor_file).unwrap(), "updated 中文");
  assert!(fs::read_dir(&remote_directory).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().ends_with(".part")));

  let download_root = fixture.dir.join("download-root");
  fs::create_dir(&download_root).unwrap();
  let existing = download_root.join("remote-transfer");
  fs::create_dir(&existing).unwrap(); fs::write(existing.join("keep.txt"), b"keep").unwrap();
  assert!(sftp::download_directory(session(), remote_directory.to_str().unwrap(), download_root.to_str().unwrap()).is_err());
  assert_eq!(fs::read(existing.join("keep.txt")).unwrap(), b"keep");
  assert_eq!(fixture.database_connections.load(Ordering::SeqCst), 0);
}

#[test]
fn sftp_refused_atomic_replacement_preserves_original_file_and_permissions() {
  use std::os::unix::fs::PermissionsExt;
  let fixture = SshFixture::with_sftp("internal-sftp -P posix-rename");
  let session = connect_session_with_verifier(&fixture.conn, |_, _, key| {
    assert_eq!(key, fixture.trusted_key); Ok(())
  }).unwrap();
  let directory = fixture.dir.join("refused-edit");
  fs::create_dir(&directory).unwrap();
  let target = directory.join("script.sh");
  fs::write(&target, b"original script").unwrap();
  fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
  let error = crate::ssh::sftp::write_file_with_session(session, target.to_str().unwrap(), "replacement script").unwrap_err();
  assert!(error.contains("refused") || error.contains("does not support"), "{error}");
  assert_eq!(fs::read(&target).unwrap(), b"original script");
  assert_eq!(fs::metadata(&target).unwrap().permissions().mode() & 0o7777, 0o755);
  assert_eq!(fs::read_dir(directory).unwrap().count(), 1);
  assert_eq!(fixture.database_connections.load(Ordering::SeqCst), 0);
}

#[test]
fn forward_connection_rejects_mismatched_host_key_before_authentication() {
  let fixture = SshFixture::new();
  fixture.changed_key.store(true, Ordering::SeqCst);
  let error = connect_forward_session(&fixture.conn, &fixture.trusted_key)
    .err()
    .expect("changed host key must be rejected");
  assert!(
    error.starts_with("SSH host key mismatch for 127.0.0.1:"),
    "{error}"
  );
  assert!(
    error.contains(&super::fingerprint_sha256(&fixture.trusted_key)),
    "{error}"
  );
  assert_no_authentication_or_forwarding(&fixture.completed_log(0));
  assert_eq!(fixture.database_connections.load(Ordering::SeqCst), 0);
}

#[test]
fn forward_listener_checks_every_connection_after_successful_probe() {
  let fixture = SshFixture::new();
  let probe = connect_session_with_verifier(&fixture.conn, |_, _, key| {
    assert_eq!(key, fixture.trusted_key);
    Ok(())
  })
  .expect("authenticate probe with the trusted host key");
  let tunnel =
    spawn_tunnel_with_session(&fixture.conn, probe).expect("probe database and start tunnel");
  // Ensure the listener is shut down even if a regression makes an assertion panic.
  struct StopTunnel(Arc<AtomicBool>);
  impl Drop for StopTunnel {
    fn drop(&mut self) {
      self.0.store(true, Ordering::Relaxed);
    }
  }
  let _stop = StopTunnel(tunnel.shutdown.clone());
  assert!(fixture.completed_log(0).contains("Accepted publickey"));
  assert_eq!(fixture.database_connections.load(Ordering::SeqCst), 1);

  // The first forward works. A replacement host is then rejected twice; restoring
  // the trusted host works again, proving a rejection never replaces the pin.
  for (index, changed) in [false, true, true, false].into_iter().enumerate() {
    fixture.changed_key.store(changed, Ordering::SeqCst);
    let before = fixture.database_connections.load(Ordering::SeqCst);
    let mut client = TcpStream::connect(("127.0.0.1", tunnel.port)).unwrap();
    client
      .set_read_timeout(Some(Duration::from_secs(5)))
      .unwrap();
    client
      .set_write_timeout(Some(Duration::from_secs(5)))
      .unwrap();
    let mut greeting = [0; 5];
    if changed {
      match client.read(&mut greeting) {
        Ok(0) => {}
        Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => {}
        other => panic!("changed host must close the forward immediately: {other:?}"),
      }
    } else {
      client
        .read_exact(&mut greeting)
        .expect("forward MySQL greeting");
      assert_eq!(greeting, GREETING);
      client.write_all(b"database-test").unwrap();
      let mut echoed = [0; 13];
      client.read_exact(&mut echoed).unwrap();
      assert_eq!(&echoed, b"database-test");
    }
    drop(client);
    let log = fixture.completed_log(index + 1);
    if changed {
      assert_no_authentication_or_forwarding(&log);
      assert_eq!(fixture.database_connections.load(Ordering::SeqCst), before);
      assert!(tunnel.host_key_error.lock().as_deref().unwrap().contains("Close this connection and reconnect"));
    } else {
      assert!(log.contains("Accepted publickey"), "{log}");
      assert!(log.contains("direct-tcpip"), "{log}");
      assert_eq!(
        fixture.database_connections.load(Ordering::SeqCst),
        before + 1
      );
      assert!(tunnel.host_key_error.lock().is_none());
    }
  }
}
