use base64::Engine;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::store::host_keys::HostKeyStore;

pub fn fingerprint_sha256(key: &[u8]) -> String {
  let digest = Sha256::digest(key);
  let b64 = base64::engine::general_purpose::STANDARD.encode(digest);
  format!("SHA256:{}", b64.trim_end_matches('='))
}

/// Unknown and changed keys are challenged before any authentication.
pub fn verify_host_key(
  _app: &AppHandle,
  store: &HostKeyStore,
  host: &str,
  port: u16,
  key: &[u8],
) -> Result<(), String> {
  store.verify(host, port, &fingerprint_sha256(key))
}
