use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;

use crate::secret_crypto::{app_data_dir, atomic_private_write, ensure_private_file};

const CHALLENGE_LIFETIME: Duration = Duration::from_secs(300);
pub const CHALLENGE_PREFIX: &str = "SSH_HOST_KEY_CHALLENGE:";

#[derive(Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct HostKeySchema {
  keys: HashMap<String, String>,
  // Legacy TOFU entries have no confirmation record. They are displayed for
  // comparison but must be verified once before credentials are sent.
  #[serde(default)]
  confirmed: HashSet<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyChallenge {
  pub challenge_id: String,
  pub host: String,
  pub port: u16,
  pub fingerprint: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub previous_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedHostKey { pub host: String, pub port: u16, pub fingerprint: String }

struct PendingChallenge { challenge: HostKeyChallenge, created: Instant }
struct HostKeyState { schema: HostKeySchema, pending: HashMap<String, PendingChallenge> }

#[derive(Clone)]
pub struct HostKeyStore { path: PathBuf, inner: Arc<Mutex<HostKeyState>>, load_error: Option<Arc<String>> }

fn endpoint(host: &str, port: u16) -> String { format!("{host}:{port}") }

fn validate_fingerprint(fingerprint: &str) -> bool {
  fingerprint.strip_prefix("SHA256:")
    .and_then(|raw| base64::engine::general_purpose::STANDARD_NO_PAD.decode(raw).ok())
    .is_some_and(|bytes| bytes.len() == 32)
}

fn read_schema(path: &Path) -> Result<HostKeySchema, String> {
  match path.symlink_metadata() {
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(HostKeySchema::default()),
    Err(e) => return Err(format!("inspect saved SSH identities: {e}")),
    Ok(_) => (),
  }
  ensure_private_file(path)?;
  let raw = fs::read_to_string(path).map_err(|e| format!("read host keys: {e}"))?;
  let schema: HostKeySchema = serde_json::from_str(&raw)
    .map_err(|e| format!("SSH_HOST_KEY_STORE_INVALID: Cannot parse saved SSH identities: {e}. Restore the trust file from a trusted backup before reconnecting."))?;
  for (host, fingerprint) in &schema.keys {
    if host.rsplit_once(':').and_then(|(_, p)| p.parse::<u16>().ok()).is_none() || !validate_fingerprint(fingerprint) {
      return Err("SSH_HOST_KEY_STORE_INVALID: Saved SSH host identity is invalid; reconnecting is disabled".into());
    }
  }
  if schema.confirmed.iter().any(|host| !schema.keys.contains_key(host)) {
    return Err("SSH_HOST_KEY_STORE_INVALID: Confirmed identity has no saved fingerprint".into());
  }
  Ok(schema)
}

impl HostKeyStore {
  pub fn load(app: &AppHandle) -> Result<Self, String> {
    let path = app_data_dir(app)?.join("ssh-host-keys.json");
    Ok(Self::load_available(path))
  }
  fn load_available(path: PathBuf) -> Self {
    Self::load_path(path.clone()).unwrap_or_else(|error| Self {
      path,
      inner: Arc::new(Mutex::new(HostKeyState { schema: HostKeySchema::default(), pending: HashMap::new() })),
      load_error: Some(Arc::new(error)),
    })
  }

  pub(crate) fn load_path(path: PathBuf) -> Result<Self, String> {
    let schema = read_schema(&path)?;
    Ok(Self { path, inner: Arc::new(Mutex::new(HostKeyState { schema, pending: HashMap::new() })), load_error: None })
  }

  fn assert_integrity(&self, state: &HostKeyState) -> Result<(), String> {
    if let Some(error) = &self.load_error { return Err(error.as_ref().clone()); }
    if read_schema(&self.path)? != state.schema {
      return Err("SSH_HOST_KEY_STORE_CHANGED: The saved trust file changed outside the application; restart and inspect it before reconnecting".into());
    }
    Ok(())
  }

  fn persist(&self, schema: &HostKeySchema) -> Result<(), String> {
    atomic_private_write(&self.path, &serde_json::to_vec_pretty(schema).map_err(|e| e.to_string())?)
  }

  /// Unknown and changed identities always stop before authentication. Only a
  /// backend native confirmation can consume this challenge and save trust.
  pub fn verify(&self, host: &str, port: u16, fingerprint: &str) -> Result<(), String> {
    let mut state = self.inner.lock();
    self.assert_integrity(&state)?;
    let address = endpoint(host, port);
    let previous = state.schema.keys.get(&address).cloned();
    if previous.as_deref() == Some(fingerprint) && state.schema.confirmed.contains(&address) { return Ok(()); }
    state.pending.retain(|_, pending| pending.created.elapsed() < CHALLENGE_LIFETIME);
    let challenge = if let Some(pending) = state.pending.values().find(|p| p.challenge.host == host && p.challenge.port == port && p.challenge.fingerprint == fingerprint && p.challenge.previous_fingerprint == previous) {
      pending.challenge.clone()
    } else {
      if state.pending.len() >= 256 { return Err("Too many pending SSH identity confirmations; retry later".into()); }
      let challenge = HostKeyChallenge { challenge_id: Uuid::new_v4().to_string(), host: host.into(), port, fingerprint: fingerprint.into(), previous_fingerprint: previous };
      state.pending.insert(challenge.challenge_id.clone(), PendingChallenge { challenge: challenge.clone(), created: Instant::now() });
      challenge
    };
    Err(format!("{CHALLENGE_PREFIX}{}", serde_json::to_string(&challenge).map_err(|e| e.to_string())?))
  }

  pub fn pending_confirmation(&self, challenge_id: &str, fingerprint: &str) -> Result<HostKeyChallenge, String> {
    let state = self.inner.lock();
    self.assert_integrity(&state)?;
    let pending = state.pending.get(challenge_id).ok_or("SSH identity confirmation expired; reconnect to inspect the current key")?;
    if pending.created.elapsed() >= CHALLENGE_LIFETIME || pending.challenge.fingerprint != fingerprint {
      return Err("SSH identity confirmation expired or fingerprint changed; reconnect to inspect the current key".into());
    }
    if state.schema.keys.get(&endpoint(&pending.challenge.host, pending.challenge.port)) != pending.challenge.previous_fingerprint.as_ref() {
      return Err("Saved SSH identity changed during confirmation; reconnect to inspect the current key".into());
    }
    Ok(pending.challenge.clone())
  }

  pub fn confirm(&self, challenge_id: &str, fingerprint: &str) -> Result<(), String> {
    let challenge = self.pending_confirmation(challenge_id, fingerprint)?;
    let mut state = self.inner.lock();
    self.assert_integrity(&state)?;
    if !state.pending.get(challenge_id).is_some_and(|pending| pending.created.elapsed() < CHALLENGE_LIFETIME && pending.challenge.fingerprint == fingerprint) {
      return Err("SSH identity confirmation expired; reconnect".into());
    }
    if state.schema.keys.get(&endpoint(&challenge.host, challenge.port)) != challenge.previous_fingerprint.as_ref() {
      return Err("Saved SSH identity changed during confirmation; reconnect".into());
    }
    let mut next = state.schema.clone();
    let address = endpoint(&challenge.host, challenge.port);
    next.keys.insert(address.clone(), challenge.fingerprint);
    next.confirmed.insert(address);
    self.persist(&next)?;
    state.schema = next;
    state.pending.remove(challenge_id);
    Ok(())
  }

  pub fn list(&self) -> Result<Vec<TrustedHostKey>, String> {
    let state = self.inner.lock();
    self.assert_integrity(&state)?;
    let mut keys: Vec<_> = state.schema.keys.iter().filter_map(|(address, fingerprint)| {
      let (host, port) = address.rsplit_once(':')?;
      Some(TrustedHostKey { host: host.into(), port: port.parse().ok()?, fingerprint: fingerprint.clone() })
    }).collect();
    keys.sort_by(|a, b| (&a.host, a.port).cmp(&(&b.host, b.port)));
    Ok(keys)
  }

  pub fn forget(&self, host: &str, port: u16, fingerprint: &str) -> Result<(), String> {
    let mut state = self.inner.lock();
    self.assert_integrity(&state)?;
    let address = endpoint(host, port);
    if state.schema.keys.get(&address).map(String::as_str) != Some(fingerprint) {
      return Err("Saved SSH identity changed; refresh the fingerprint before removing it".into());
    }
    let mut next = state.schema.clone();
    next.keys.remove(&address);
    next.confirmed.remove(&address);
    self.persist(&next)?;
    state.schema = next;
    state.pending.retain(|_, pending| pending.challenge.host != host || pending.challenge.port != port);
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::secret_crypto::ensure_private_dir;
  use crate::ssh::host_verify::fingerprint_sha256;

  fn store() -> HostKeyStore {
    let directory = std::env::temp_dir().join(format!("host-key-tests-{}", Uuid::new_v4()));
    ensure_private_dir(&directory).unwrap();
    HostKeyStore::load_path(directory.join("ssh-host-keys.json")).unwrap()
  }
  fn challenge(store: &HostKeyStore, key: &[u8]) -> HostKeyChallenge {
    let error = store.verify("ssh.example", 22, &fingerprint_sha256(key)).unwrap_err();
    serde_json::from_str(error.strip_prefix(CHALLENGE_PREFIX).unwrap()).unwrap()
  }
  #[test]
  fn unknown_and_rotated_keys_are_not_saved_until_explicit_confirmation() {
    let store = store();
    let first = challenge(&store, b"first key");
    assert!(!store.path.exists());
    assert!(first.previous_fingerprint.is_none());
    assert!(store.confirm(&first.challenge_id, &fingerprint_sha256(b"wrong key")).is_err());
    store.confirm(&first.challenge_id, &first.fingerprint).unwrap();
    store.verify("ssh.example", 22, &first.fingerprint).unwrap();
    let rotated = challenge(&store, b"rotated key");
    assert_eq!(rotated.previous_fingerprint, Some(first.fingerprint.clone()));
    assert_eq!(store.list().unwrap()[0].fingerprint, first.fingerprint);
    store.confirm(&rotated.challenge_id, &rotated.fingerprint).unwrap();
    store.verify("ssh.example", 22, &rotated.fingerprint).unwrap();
    assert!(store.confirm(&rotated.challenge_id, &rotated.fingerprint).is_err());
    fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
  }
  #[test]
  fn malformed_deleted_or_externally_changed_trust_file_fails_closed() {
    let store = store();
    let first = challenge(&store, b"first key");
    store.confirm(&first.challenge_id, &first.fingerprint).unwrap();
    fs::write(&store.path, b"{broken").unwrap();
    assert!(HostKeyStore::load_path(store.path.clone()).is_err());
    assert!(store.verify("ssh.example", 22, &first.fingerprint).is_err());
    assert!(store.verify("ssh.example", 22, &fingerprint_sha256(b"new key")).is_err());
    fs::remove_file(&store.path).unwrap();
    assert!(store.verify("ssh.example", 22, &first.fingerprint).is_err());
    fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
  }
  #[test]
  fn failed_persistence_does_not_publish_trust_and_expired_challenges_cannot_be_confirmed() {
    let mut store = store();
    let first = challenge(&store, b"first key");
    store.inner.lock().pending.get_mut(&first.challenge_id).unwrap().created = Instant::now() - CHALLENGE_LIFETIME;
    assert!(store.confirm(&first.challenge_id, &first.fingerprint).is_err());
    let fresh = challenge(&store, b"first key");
    let directory = store.path.parent().unwrap().to_path_buf();
    store.path = directory.join("missing").join("ssh-host-keys.json");
    assert!(store.confirm(&fresh.challenge_id, &fresh.fingerprint).is_err());
    assert!(store.inner.lock().schema.keys.is_empty());
    fs::remove_dir_all(directory).unwrap();
  }

  #[test]
  fn legacy_tofu_entries_each_require_confirmation_even_when_fingerprint_matches() {
    let empty = store();
    let fingerprint = fingerprint_sha256(b"legacy key");
    atomic_private_write(&empty.path, &serde_json::to_vec(&serde_json::json!({ "keys": {
      "ssh.example:22": fingerprint, "other.example:22": fingerprint
    }})).unwrap()).unwrap();
    let store = HostKeyStore::load_path(empty.path.clone()).unwrap();
    let first = challenge(&store, b"legacy key");
    assert_eq!(first.previous_fingerprint.as_deref(), Some(fingerprint.as_str()));
    store.confirm(&first.challenge_id, &first.fingerprint).unwrap();
    store.verify("ssh.example", 22, &fingerprint).unwrap();
    assert!(store.verify("other.example", 22, &fingerprint).unwrap_err().starts_with(CHALLENGE_PREFIX));
    let reopened = HostKeyStore::load_path(empty.path.clone()).unwrap();
    reopened.verify("ssh.example", 22, &fingerprint).unwrap();
    assert!(reopened.verify("other.example", 22, &fingerprint).is_err());
    fs::remove_dir_all(empty.path.parent().unwrap()).unwrap();
  }
  #[test]
  fn unavailable_store_preserves_corrupt_file_and_blocks_every_ssh_trust_operation() {
    let empty = store();
    atomic_private_write(&empty.path, b"{broken trust data").unwrap();
    let unavailable = HostKeyStore::load_available(empty.path.clone());
    let fingerprint = fingerprint_sha256(b"host key");
    assert!(unavailable.verify("ssh.example", 22, &fingerprint).is_err());
    assert!(unavailable.list().is_err());
    assert!(unavailable.confirm("invented", &fingerprint).is_err());
    assert!(unavailable.forget("ssh.example", 22, &fingerprint).is_err());
    assert_eq!(fs::read(&empty.path).unwrap(), b"{broken trust data");
    assert!(unavailable.inner.lock().pending.is_empty());
    fs::remove_dir_all(empty.path.parent().unwrap()).unwrap();
  }
}
