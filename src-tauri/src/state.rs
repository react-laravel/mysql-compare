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
  drivers: Mutex<HashMap<String, Arc<EngineDriver>>>,
}

impl AppState {
  pub fn new(app: &AppHandle) -> Result<Self, String> {
    Ok(Self {
      connections: ConnectionStore::load(app)?,
      host_keys: HostKeyStore::load(app)?,
      tunnels: TunnelManager::new(),
      terminals: TerminalManager::new(),
      drivers: Mutex::new(HashMap::new()),
    })
  }

  pub async fn get_driver(
    &self,
    app: &AppHandle,
    connection_id: &str,
  ) -> Result<Arc<EngineDriver>, String> {
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
      Some(self.tunnels.ensure(app, &self.host_keys, &conn)?)
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
    resolved.id = test_id.clone();
    let local_port = if resolved.use_ssh {
      Some(self.tunnels.ensure(app, &self.host_keys, &resolved)?)
    } else {
      None
    };
    let result = EngineDriver::test_connection(&resolved, local_port).await;
    self.tunnels.close(&test_id);
    result
  }

  pub async fn close_connection(&self, connection_id: &str) {
    let driver = {
      let mut drivers = self.drivers.lock();
      drivers.remove(connection_id)
    };
    if let Some(d) = driver {
      if let Ok(owned) = Arc::try_unwrap(d) {
        owned.close().await;
      }
    }
    self.tunnels.close(connection_id);
  }
}
