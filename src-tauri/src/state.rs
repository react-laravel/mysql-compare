use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::AppHandle;

use crate::drivers::EngineDriver;
use crate::ssh::terminal::TerminalManager;
use crate::ssh::tunnel::TunnelManager;
use crate::store::connection_store::ConnectionStore;
use crate::store::host_keys::HostKeyStore;
use crate::types::ConnectionConfig;

pub struct AppState {
  pub connections: ConnectionStore,
  pub host_keys: HostKeyStore,
  pub tunnels: TunnelManager,
  pub terminals: TerminalManager,
  pub operations: crate::operations::Operations,
  pub file_grants: crate::file_grants::FileGrants,
  drivers: Mutex<HashMap<String, Arc<EngineDriver>>>,
}
struct PendingTunnelWork(Option<crate::operations::Cancellation>);
impl Drop for PendingTunnelWork {
  fn drop(&mut self) { if let Some(cancellation) = self.0.take() { cancellation.cancel(); } }
}
struct TestTunnelCleanup { manager: TunnelManager, id: String }
impl Drop for TestTunnelCleanup { fn drop(&mut self) { self.manager.close(&self.id); } }

impl AppState {
  pub fn new(app: &AppHandle) -> Result<Self, String> {
    Ok(Self {
      connections: ConnectionStore::load(app)?,
      host_keys: HostKeyStore::load(app)?,
      tunnels: TunnelManager::new(),
      terminals: TerminalManager::new(),
      operations: crate::operations::Operations::default(),
      file_grants: crate::file_grants::FileGrants::default(),
      drivers: Mutex::new(HashMap::new()),
    })
  }

  /// SSH's native handshake and authentication are blocking. Keep them off
  /// async workers and preserve the owning operation's cancellation signal.
  pub async fn ensure_tunnel(&self, app: &AppHandle, conn: &ConnectionConfig) -> Result<u16, String> {
    let cancellation = crate::operations::current().unwrap_or_else(crate::operations::Cancellation::new);
    let mut pending = PendingTunnelWork(Some(cancellation.clone()));
    let app = app.clone(); let conn = conn.clone();
    let manager = self.tunnels.clone(); let keys = self.host_keys.clone();
    let result = tokio::task::spawn_blocking(move || crate::operations::with_cancellation(Some(cancellation), || {
      let result = manager.ensure(&app, &keys, &conn);
      if let Err(error) = crate::operations::check() {
        // Test listeners belong to this one request. Shared connection caches
        // remain available to other tabs until the connection is closed.
        if conn.id.contains("::test::") { manager.close(&conn.id); }
        return Err(error);
      }
      result
    })).await.map_err(|e| format!("SSH connection task failed: {e}"))?;
    pending.0 = None;
    result
  }

  pub async fn get_driver(
    &self,
    app: &AppHandle,
    connection_id: &str,
  ) -> Result<Arc<EngineDriver>, String> {
    if let Some(error) = self.tunnels.host_key_error(connection_id) { return Err(error); }
    {
      let drivers = self.drivers.lock();
      if let Some(d) = drivers.get(connection_id).cloned() {
        return Ok(d);
      }
    }
    let conn = self
      .connections
      .get_full(app, connection_id)?
      .ok_or_else(|| format!("Connection {connection_id} not found"))?;
    let local_port = if conn.use_ssh {
      Some(self.ensure_tunnel(app, &conn).await?)
    } else {
      None
    };
    let driver = EngineDriver::open(conn, local_port).await?;
    let arc = Arc::new(driver);
    self
      .drivers
      .lock()
      .insert(connection_id.to_string(), arc.clone());
    Ok(arc)
  }

  pub async fn test_connection(
    &self,
    app: &AppHandle,
    conn: &ConnectionConfig,
  ) -> Result<String, String> {
    let mut resolved = conn.clone();
    self.connections.resolve_ssh_source(app, &mut resolved)?;
    if !resolved.id.is_empty() {
      if let Some(full) = self.connections.get_full(app, &resolved.id)? {
        if resolved
          .password
          .as_deref()
          .map(|s| s.trim().is_empty())
          .unwrap_or(true)
        {
          resolved.password = full.password;
        }
        if resolved.ssh_password.is_none() {
          resolved.ssh_password = full.ssh_password;
        }
        if resolved.ssh_private_key.is_none() {
          resolved.ssh_private_key = full.ssh_private_key;
        }
        if resolved.ssh_passphrase.is_none() {
          resolved.ssh_passphrase = full.ssh_passphrase;
        }
      }
    }
    let test_id = format!("{}::test::{}", resolved.id, uuid::Uuid::new_v4());
    let _cleanup = TestTunnelCleanup { manager: self.tunnels.clone(), id: test_id.clone() };
    resolved.id = test_id.clone();
    let local_port = if resolved.use_ssh {
      Some(self.ensure_tunnel(app, &resolved).await?)
    } else {
      None
    };
    let result = EngineDriver::test_connection(&resolved, local_port).await;
    result
  }

  pub fn connection_error(&self, connection_id: &str, error: String) -> String {
    if let Some(identity_error) = self.tunnels.host_key_error(connection_id) {
      if error.contains(identity_error.as_str()) { error } else { format!("{identity_error}\n{error}") }
    } else { error }
  }

  pub async fn close_connection(&self, connection_id: &str) {
    let driver = {
      let mut drivers = self.drivers.lock();
      drivers.remove(connection_id)
    };
    if let Some(d) = driver {
      // sqlx Pool 可 Clone，close() 对所有克隆生效；无需等 Arc 独占即可关闭。
      d.close().await;
    }
    self.tunnels.close(connection_id);
  }

  /// Future requests use the saved options; in-flight operations keep their
  /// snapshot without tearing down a shared SSH tunnel.
  pub fn invalidate_driver(&self, connection_id: &str) {
    self.drivers.lock().remove(connection_id);
  }

  pub async fn test_database_connection(&self, app: &AppHandle, conn: &ConnectionConfig) -> Result<String, String> {
    let mut resolved = conn.clone();
    self.connections.resolve_ssh_source(app, &mut resolved)?;
    let test_id = format!("{}::test::{}", resolved.id, uuid::Uuid::new_v4());
    let _cleanup = TestTunnelCleanup { manager: self.tunnels.clone(), id: test_id.clone() };
    resolved.id = test_id.clone();
    let port = if resolved.use_ssh { Some(self.ensure_tunnel(app, &resolved).await?) } else { None };
    let result = EngineDriver::test_database_connection(&resolved, port).await;
    result
  }
}
