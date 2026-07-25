use base64::Engine;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::store::host_keys::HostKeyStore;

pub fn fingerprint_sha256(key: &[u8]) -> String {
  let digest = Sha256::digest(key);
  let b64 = base64::engine::general_purpose::STANDARD.encode(digest);
  format!("SHA256:{}", b64.trim_end_matches('='))
}

/// TOFU: accept first seen host key and persist; reject mismatch.
pub fn verify_host_key(
  app: &AppHandle,
  store: &HostKeyStore,
  host: &str,
  port: u16,
  key: &[u8],
) -> Result<(), String> {
  let fp = fingerprint_sha256(key);
  if let Some(existing) = store.get(host, port) {
    if existing == fp {
      return Ok(());
    }
    return Err(format!(
      "SSH host key mismatch for {host}:{port}. Expected {existing}, got {fp}"
    ));
  }
  store.set(host, port, &fp)?;
  let _ = app;
  Ok(())
}
