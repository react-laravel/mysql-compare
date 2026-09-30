use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;

use crate::secret_crypto::{app_data_dir, decrypt_secret, encrypt_secret};
use crate::types::{
  ConnectionConfig, ConnectionOrganizationItem, DatabaseCredentialConfig, DbEngine, SafeConnection, SafeDatabaseCredential,
};

#[cfg(test)]
#[path = "connection_organization_tests.rs"]
mod connection_organization_tests;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDatabaseCredential {
  username: Option<String>,
  password_cipher: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredConnection {
  id: String,
  engine: DbEngine,
  name: String,
  group: Option<String>,
  host: String,
  port: u16,
  username: String,
  database: Option<String>,
  databases: Option<Vec<String>>,
  show_all_databases: Option<bool>,
  database_credentials: Option<HashMap<String, StoredDatabaseCredential>>,
  #[serde(rename = "useSSH")]
  use_ssh: bool,
  ssh_host: Option<String>,
  ssh_port: Option<u16>,
  ssh_username: Option<String>,
  ssh_private_key_path: Option<String>,
  created_at: i64,
  updated_at: i64,
  password_cipher: Option<String>,
  ssh_password_cipher: Option<String>,
  ssh_private_key_cipher: Option<String>,
  ssh_passphrase_cipher: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Schema {
  connections: Vec<StoredConnection>,
}

pub struct ConnectionStore {
  path: PathBuf,
  inner: Mutex<Schema>,
}

fn now_ms() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

fn pick_secret(next: Option<&str>, previous: Option<String>) -> Option<String> {
  match next {
    Some(v) if !v.trim().is_empty() => Some(v.to_string()),
    _ => previous,
  }
}

fn pick_ssh_secret(next: Option<&str>, previous: Option<String>) -> Option<String> {
  match next {
    Some(v) if !v.trim().is_empty() => Some(v.to_string()),
    Some(_) => None,
    None => previous,
  }
}

impl ConnectionStore {
  pub fn load(app: &AppHandle) -> Result<Self, String> {
    let path = app_data_dir(app)?.join("connections.json");
    let schema = if path.exists() {
      let raw = fs::read_to_string(&path).map_err(|e| format!("read connections: {e}"))?;
      serde_json::from_str(&raw).unwrap_or_default()
    } else {
      Schema::default()
    };
    Ok(Self {
      path,
      inner: Mutex::new(schema),
    })
  }

  fn persist(&self, schema: &Schema) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(schema).map_err(|e| e.to_string())?;
    let temporary = self.path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let result = fs::write(&temporary, raw).and_then(|_| fs::rename(&temporary, &self.path));
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result.map_err(|e| format!("write connections: {e}"))
  }

  pub fn list_safe(&self) -> Vec<SafeConnection> {
    self.inner.lock().connections.iter().map(to_safe).collect()
  }

  pub fn organize(&self, items: Vec<ConnectionOrganizationItem>) -> Result<Vec<SafeConnection>, String> {
    let mut guard = self.inner.lock();
    let mut remaining: HashMap<_, _> = guard.connections.iter().map(|c| (c.id.clone(), c.clone())).collect();
    if items.len() != remaining.len() {
      return Err("CONNECTION_LIST_CHANGED".into());
    }
    let mut connections = Vec::with_capacity(items.len());
    for item in items {
      let mut connection = remaining.remove(&item.id).ok_or("CONNECTION_LIST_CHANGED")?;
      connection.group = item.group.map(|name| name.trim().to_string()).filter(|name| !name.is_empty());
      connections.push(connection);
    }
    // Keep encrypted credentials and active drivers untouched. Persist the
    // entire order atomically before publishing it to readers.
    let next = Schema { connections };
    let raw = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
    let temporary = self.path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let result = fs::write(&temporary, raw).and_then(|_| fs::rename(&temporary, &self.path));
    if let Err(error) = result {
      let _ = fs::remove_file(&temporary);
      return Err(format!("write connections: {error}"));
    }
    *guard = next;
    Ok(guard.connections.iter().map(to_safe).collect())
  }

  pub fn get_full(&self, app: &AppHandle, id: &str) -> Result<Option<ConnectionConfig>, String> {
    let guard = self.inner.lock();
    let Some(stored) = guard.connections.iter().find(|c| c.id == id) else {
      return Ok(None);
    };
    Ok(Some(to_full(app, stored)?))
  }

  pub fn upsert(&self, app: &AppHandle, mut conn: ConnectionConfig) -> Result<SafeConnection, String> {
    self.resolve_ssh_source(app, &mut conn)?;
    if conn.id.trim().is_empty() {
      conn.id = Uuid::new_v4().to_string();
    }
    let previous = self.get_full(app, &conn.id)?;
    if let Some(prev) = previous {
      conn.password = pick_secret(conn.password.as_deref(), prev.password);
      conn.ssh_password = pick_ssh_secret(conn.ssh_password.as_deref(), prev.ssh_password);
      conn.ssh_private_key =
        pick_ssh_secret(conn.ssh_private_key.as_deref(), prev.ssh_private_key);
      conn.ssh_passphrase =
        pick_ssh_secret(conn.ssh_passphrase.as_deref(), prev.ssh_passphrase);
      if conn.created_at == 0 {
        conn.created_at = prev.created_at;
      }
      if conn.databases.is_none() { conn.databases = prev.databases; }
      if conn.show_all_databases.is_none() { conn.show_all_databases = prev.show_all_databases; }
      if conn.database_credentials.is_none() {
        conn.database_credentials = prev.database_credentials;
      }
    }
    if conn.created_at == 0 {
      conn.created_at = now_ms();
    }
    conn.updated_at = now_ms();

    let stored = to_stored(app, &conn)?;
    let mut guard = self.inner.lock();
    let mut next = guard.clone();
    if let Some(idx) = next.connections.iter().position(|c| c.id == stored.id) {
      next.connections[idx] = stored.clone();
    } else {
      next.connections.push(stored.clone());
    }
    self.persist(&next)?;
    *guard = next;
    Ok(to_safe(&stored))
  }

  pub fn resolve_ssh_source(
    &self,
    app: &AppHandle,
    conn: &mut ConnectionConfig,
  ) -> Result<(), String> {
    let Some(source_id) = conn
      .ssh_source_connection_id
      .as_deref()
      .map(str::trim)
      .filter(|id| !id.is_empty())
    else {
      return Ok(());
    };
    let source = self
      .get_full(app, source_id)?
      .ok_or_else(|| "SSH source connection not found".to_string())?;
    if !source.use_ssh {
      return Err("The selected connection does not use SSH".to_string());
    }
    conn.ssh_password = source.ssh_password;
    conn.ssh_private_key = source.ssh_private_key;
    conn.ssh_passphrase = source.ssh_passphrase;
    conn.ssh_source_connection_id = None;
    Ok(())
  }

  pub fn remove(&self, id: &str) -> Result<(), String> {
    let mut guard = self.inner.lock();
    guard.connections.retain(|c| c.id != id);
    self.persist(&guard)
  }

  pub fn set_database_credential(
    &self,
    app: &AppHandle,
    id: &str,
    database: &str,
    credential: DatabaseCredentialConfig,
  ) -> Result<SafeConnection, String> {
    let mut full = self
      .get_full(app, id)?
      .ok_or_else(|| format!("Connection {id} not found"))?;
    let resolved = crate::drivers::connection_options::resolve_credential(&full, database, credential);
    let mut map = full.database_credentials.take().unwrap_or_default();
    if let Some(credential) = resolved { map.insert(database.to_string(), credential); }
    else { map.remove(database); }
    full.database_credentials = Some(map);
    self.upsert(app, full)
  }

  pub fn update_database_browsing(&self, app: &AppHandle, id: &str, database: Option<String>, show_all: Option<bool>, credential: Option<DatabaseCredentialConfig>) -> Result<SafeConnection, String> {
    let mut full = self.get_full(app, id)?.ok_or("Connection not found")?;
    if let Some(database) = database {
      let database = database.trim();
      if database.is_empty() || database.contains('\0') { return Err("Database name is required".into()); }
      let databases = full.databases.get_or_insert_with(Vec::new);
      if !databases.iter().any(|name| name == database) { databases.push(database.into()); }
      if let Some(credential) = credential {
        let resolved = crate::drivers::connection_options::resolve_credential(&full, database, credential);
        let credentials = full.database_credentials.get_or_insert_with(HashMap::new);
        if let Some(credential) = resolved { credentials.insert(database.into(), credential); }
        else { credentials.remove(database); }
      }
    }
    if let Some(show_all) = show_all { full.show_all_databases = Some(show_all); }
    self.upsert(app, full)
  }
}

fn to_stored(app: &AppHandle, c: &ConnectionConfig) -> Result<StoredConnection, String> {
  let database_credentials = match &c.database_credentials {
    None => None,
    Some(map) => {
      let mut out = HashMap::new();
      for (db, cred) in map {
        let db_name = db.trim();
        let username = cred.username.as_deref().map(str::trim).filter(|s| !s.is_empty());
        let Some(username) = username else { continue };
        if db_name.is_empty() {
          continue;
        }
        out.insert(
          db_name.to_string(),
          StoredDatabaseCredential {
            username: Some(username.to_string()),
            password_cipher: encrypt_secret(app, cred.password.clone())?,
          },
        );
      }
      if out.is_empty() {
        None
      } else {
        Some(out)
      }
    }
  };

  Ok(StoredConnection {
    id: if c.id.is_empty() {
      Uuid::new_v4().to_string()
    } else {
      c.id.clone()
    },
    engine: c.engine.clone(),
    name: c.name.clone(),
    group: c.group.clone(),
    host: c.host.clone(),
    port: c.port,
    username: c.username.clone(),
    database: c.database.clone(),
    databases: c.databases.clone(),
    show_all_databases: c.show_all_databases,
    database_credentials,
    use_ssh: c.use_ssh,
    ssh_host: c.ssh_host.clone(),
    ssh_port: c.ssh_port,
    ssh_username: c.ssh_username.clone(),
    ssh_private_key_path: c.ssh_private_key_path.clone(),
    created_at: c.created_at,
    updated_at: c.updated_at,
    password_cipher: encrypt_secret(app, c.password.clone())?,
    ssh_password_cipher: encrypt_secret(app, c.ssh_password.clone())?,
    ssh_private_key_cipher: encrypt_secret(app, c.ssh_private_key.clone())?,
    ssh_passphrase_cipher: encrypt_secret(app, c.ssh_passphrase.clone())?,
  })
}

fn to_safe(s: &StoredConnection) -> SafeConnection {
  let database_credentials = s.database_credentials.as_ref().map(|map| {
    map
      .iter()
      .filter_map(|(db, cred)| {
        cred.username.as_ref().map(|username| {
          (
            db.clone(),
            SafeDatabaseCredential {
              username: Some(username.clone()),
              has_password: cred.password_cipher.is_some(),
            },
          )
        })
      })
      .collect()
  });

  SafeConnection {
    id: s.id.clone(),
    engine: s.engine.clone(),
    name: s.name.clone(),
    group: s.group.clone(),
    host: s.host.clone(),
    port: s.port,
    username: s.username.clone(),
    database: s.database.clone(),
    databases: s.databases.clone(),
    show_all_databases: s.show_all_databases,
    use_ssh: s.use_ssh,
    ssh_host: s.ssh_host.clone(),
    ssh_port: s.ssh_port,
    ssh_username: s.ssh_username.clone(),
    ssh_private_key_path: s.ssh_private_key_path.clone(),
    created_at: s.created_at,
    updated_at: s.updated_at,
    has_password: s.password_cipher.is_some(),
    database_credentials,
    has_ssh_password: s.ssh_password_cipher.is_some(),
    has_ssh_private_key: s.ssh_private_key_cipher.is_some(),
  }
}

fn to_full(app: &AppHandle, s: &StoredConnection) -> Result<ConnectionConfig, String> {
  let database_credentials = match &s.database_credentials {
    None => None,
    Some(map) => {
      let mut out = HashMap::new();
      for (db, cred) in map {
        let Some(username) = &cred.username else { continue };
        out.insert(
          db.clone(),
          DatabaseCredentialConfig {
            username: Some(username.clone()),
            password: decrypt_secret(app, cred.password_cipher.as_deref())?,
          },
        );
      }
      Some(out)
    }
  };

  Ok(ConnectionConfig {
    id: s.id.clone(),
    engine: s.engine.clone(),
    name: s.name.clone(),
    group: s.group.clone(),
    host: s.host.clone(),
    port: s.port,
    username: s.username.clone(),
    password: decrypt_secret(app, s.password_cipher.as_deref())?,
    database_credentials,
    database: s.database.clone(),
    databases: s.databases.clone(),
    show_all_databases: s.show_all_databases,
    use_ssh: s.use_ssh,
    ssh_host: s.ssh_host.clone(),
    ssh_port: s.ssh_port,
    ssh_username: s.ssh_username.clone(),
    ssh_password: decrypt_secret(app, s.ssh_password_cipher.as_deref())?,
    ssh_private_key: decrypt_secret(app, s.ssh_private_key_cipher.as_deref())?,
    ssh_private_key_path: s.ssh_private_key_path.clone(),
    ssh_passphrase: decrypt_secret(app, s.ssh_passphrase_cipher.as_deref())?,
    ssh_source_connection_id: None,
    created_at: s.created_at,
    updated_at: s.updated_at,
  })
}
