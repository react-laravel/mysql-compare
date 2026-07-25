use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::secret_crypto::app_data_dir;

#[derive(Default, Serialize, Deserialize)]
struct HostKeySchema {
  keys: HashMap<String, String>,
}

pub struct HostKeyStore {
  path: PathBuf,
  inner: Mutex<HostKeySchema>,
}

impl HostKeyStore {
  pub fn load(app: &AppHandle) -> Result<Self, String> {
    let path = app_data_dir(app)?.join("ssh-host-keys.json");
    let schema = if path.exists() {
      let raw = fs::read_to_string(&path).map_err(|e| format!("read host keys: {e}"))?;
      serde_json::from_str(&raw).unwrap_or_default()
    } else {
      HostKeySchema::default()
    };
    Ok(Self {
      path,
      inner: Mutex::new(schema),
    })
  }

  fn persist(&self, schema: &HostKeySchema) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(schema).map_err(|e| e.to_string())?;
    fs::write(&self.path, raw).map_err(|e| format!("write host keys: {e}"))
  }

  pub fn get(&self, host: &str, port: u16) -> Option<String> {
    let key = format!("{host}:{port}");
    self.inner.lock().keys.get(&key).cloned()
  }

  pub fn set(&self, host: &str, port: u16, fingerprint: &str) -> Result<(), String> {
    let key = format!("{host}:{port}");
    let mut guard = self.inner.lock();
    guard.keys.insert(key, fingerprint.to_string());
    self.persist(&guard)
  }
}
