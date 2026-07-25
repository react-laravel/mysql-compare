use std::fs;
use std::path::PathBuf;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;
use tauri::{AppHandle, Manager};

const KEY_FILE: &str = "master.key";
const ENC_PREFIX: &str = "enc:v1:";

fn ensure_private_dir(path: &PathBuf) -> Result<(), String> {
  fs::create_dir_all(path).map_err(|e| format!("create data dir: {e}"))?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
  }
  Ok(())
}

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("app data dir: {e}"))?;
  ensure_private_dir(&dir)?;
  Ok(dir)
}

fn master_key(app: &AppHandle) -> Result<[u8; 32], String> {
  let dir = app_data_dir(app)?;
  let key_path = dir.join(KEY_FILE);
  if key_path.exists() {
    let bytes = fs::read(&key_path).map_err(|e| format!("read master key: {e}"))?;
    if bytes.len() != 32 {
      return Err("master key corrupted".into());
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    return Ok(key);
  }

  let mut key = [0u8; 32];
  rand::thread_rng().fill_bytes(&mut key);
  fs::write(&key_path, key).map_err(|e| format!("write master key: {e}"))?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600));
  }
  Ok(key)
}

pub fn encrypt_secret(app: &AppHandle, value: Option<String>) -> Result<Option<String>, String> {
  let Some(plain) = value.filter(|v| !v.is_empty()) else {
    return Ok(None);
  };
  if plain.starts_with(ENC_PREFIX) {
    return Ok(Some(plain));
  }

  let key = master_key(app)?;
  let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("cipher init: {e}"))?;
  let mut nonce_bytes = [0u8; 12];
  rand::thread_rng().fill_bytes(&mut nonce_bytes);
  let nonce = Nonce::from_slice(&nonce_bytes);
  let ciphertext = cipher
    .encrypt(nonce, plain.as_bytes())
    .map_err(|e| format!("encrypt: {e}"))?;

  let mut packed = Vec::with_capacity(12 + ciphertext.len());
  packed.extend_from_slice(&nonce_bytes);
  packed.extend_from_slice(&ciphertext);
  Ok(Some(format!(
    "{ENC_PREFIX}{}",
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, packed)
  )))
}

pub fn decrypt_secret(app: &AppHandle, value: Option<&str>) -> Result<Option<String>, String> {
  let Some(raw) = value.filter(|v| !v.is_empty()) else {
    return Ok(None);
  };
  if !raw.starts_with(ENC_PREFIX) {
    return Ok(Some(raw.to_string()));
  }
  let b64 = &raw[ENC_PREFIX.len()..];
  let packed = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64)
    .map_err(|e| format!("decode secret: {e}"))?;
  if packed.len() < 13 {
    return Err("secret payload too short".into());
  }
  let (nonce_bytes, ciphertext) = packed.split_at(12);
  let key = master_key(app)?;
  let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("cipher init: {e}"))?;
  let nonce = Nonce::from_slice(nonce_bytes);
  let plain = cipher
    .decrypt(nonce, ciphertext)
    .map_err(|e| format!("decrypt: {e}"))?;
  String::from_utf8(plain).map(Some).map_err(|e| format!("utf8: {e}"))
}
