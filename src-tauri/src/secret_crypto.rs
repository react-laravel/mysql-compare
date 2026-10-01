use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use parking_lot::Mutex;
use rand::RngCore;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const KEY_FILE: &str = "master.key";
const ENC_PREFIX: &str = "enc:v2:";
const LEGACY_ENC_PREFIX: &str = "enc:v1:";
const KEY_SERVICE: &str = "mysql-compare.credential-encryption";
static KEY_LOCK: Mutex<()> = Mutex::new(());

pub fn ensure_private_dir(path: &Path) -> Result<(), String> {
  if path.symlink_metadata().is_ok_and(|m| m.file_type().is_symlink()) {
    return Err("Application data directory must not be a symbolic link".into());
  }
  fs::create_dir_all(path).map_err(|e| format!("create data dir: {e}"))?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
      .map_err(|e| format!("secure data directory permissions: {e}"))?;
  }
  Ok(())
}

/// Tighten existing files as well as newly created files. Never follow a
/// substituted symbolic link when changing permissions or reading secrets.
pub fn ensure_private_file(path: &Path) -> Result<(), String> {
  let metadata = fs::symlink_metadata(path).map_err(|e| format!("inspect private file: {e}"))?;
  if !metadata.is_file() || metadata.file_type().is_symlink() {
    return Err("Private application file must be a regular file".into());
  }
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
      .map_err(|e| format!("secure file permissions: {e}"))?;
  }
  Ok(())
}

/// Create the temporary file with private permissions before writing any
/// bytes, then atomically publish it. Failed writes leave the previous file.
pub fn atomic_private_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
  match path.symlink_metadata() {
    Ok(_) => ensure_private_file(path)?,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
    Err(e) => return Err(format!("inspect private file: {e}")),
  }
  let parent = path.parent().ok_or("Private file has no parent directory")?;
  if !parent.is_dir() { return Err("Private file parent directory does not exist".into()); }
  ensure_private_dir(parent)?;
  let temporary = parent.join(format!(".{}.tmp", Uuid::new_v4()));
  let result = (|| -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
      use std::os::unix::fs::OpenOptionsExt;
      options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|e| format!("create private file: {e}"))?;
    ensure_private_file(&temporary)?;
    file.write_all(bytes).map_err(|e| format!("write private file: {e}"))?;
    file.sync_all().map_err(|e| format!("sync private file: {e}"))?;
    drop(file);
    fs::rename(&temporary, path).map_err(|e| format!("replace private file: {e}"))?;
    Ok(())
  })();
  if result.is_err() { let _ = fs::remove_file(&temporary); }
  result
}

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|e| format!("app data dir: {e}"))?;
  ensure_private_dir(&dir)?;
  Ok(dir)
}

trait KeyStore {
  fn read(&self, account: &str) -> Result<Option<Vec<u8>>, String>;
  fn write(&self, account: &str, bytes: &[u8]) -> Result<(), String>;
}

struct SystemKeyStore;

#[cfg(target_os = "macos")]
impl KeyStore for SystemKeyStore {
  fn read(&self, account: &str) -> Result<Option<Vec<u8>>, String> {
    use security_framework::passwords::{generic_password, PasswordOptions};
    match generic_password(PasswordOptions::new_generic_password(KEY_SERVICE, account)) {
      Ok(bytes) => Ok(Some(bytes)),
      Err(error) if error.code() == -25300 => Ok(None), // errSecItemNotFound
      Err(error) => Err(format!("System Keychain unavailable: {error}")),
    }
  }
  fn write(&self, account: &str, bytes: &[u8]) -> Result<(), String> {
    // Never overwrite an encryption key if two app processes initialize at
    // once. A duplicate must be read back and compared by master_key_at.
    let keychain = security_framework::os::macos::keychain::SecKeychain::default()
      .map_err(|error| format!("System Keychain unavailable: {error}"))?;
    match keychain.add_generic_password(KEY_SERVICE, account, bytes) {
      Ok(()) => Ok(()),
      Err(error) if error.code() == -25299 => Ok(()), // errSecDuplicateItem
      Err(error) => Err(format!("Save encryption key in System Keychain: {error}")),
    }
  }
}

#[cfg(any(windows, target_os = "linux", target_os = "freebsd", target_os = "openbsd"))]
impl KeyStore for SystemKeyStore {
  fn read(&self, account: &str) -> Result<Option<Vec<u8>>, String> {
    let entry = keyring::Entry::new(KEY_SERVICE, account).map_err(|e| format!("System credential store: {e}"))?;
    match entry.get_secret() {
      Ok(bytes) => Ok(Some(bytes)),
      Err(keyring::Error::NoEntry) => Ok(None),
      Err(error) => Err(format!("System credential store unavailable: {error}")),
    }
  }
  fn write(&self, account: &str, bytes: &[u8]) -> Result<(), String> {
    keyring::Entry::new(KEY_SERVICE, account).and_then(|entry| entry.set_secret(bytes))
      .map_err(|e| format!("Save encryption key in system credential store: {e}"))
  }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux", target_os = "freebsd", target_os = "openbsd")))]
impl KeyStore for SystemKeyStore {
  fn read(&self, _: &str) -> Result<Option<Vec<u8>>, String> { Err("No supported system credential store on this platform".into()) }
  fn write(&self, _: &str, _: &[u8]) -> Result<(), String> { Err("No supported system credential store on this platform".into()) }
}

fn key_account(dir: &Path) -> String {
  format!("master-key-{}", hex::encode(Sha256::digest(dir.as_os_str().as_encoded_bytes())))
}

fn key_bytes(bytes: &[u8]) -> Result<[u8; 32], String> {
  bytes.try_into().map_err(|_| "Credential encryption key is corrupted".into())
}

fn master_key_at(dir: &Path, store: &impl KeyStore, create: bool) -> Result<[u8; 32], String> {
  let account = key_account(dir);
  let saved = store.read(&account)?.map(|b| key_bytes(&b)).transpose()?;
  let legacy_path = dir.join(KEY_FILE);
  let legacy = match legacy_path.symlink_metadata() {
    Ok(_) => {
      ensure_private_file(&legacy_path)?;
      Some(key_bytes(&fs::read(&legacy_path).map_err(|e| format!("read legacy master key: {e}"))?)?)
    },
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
    Err(e) => return Err(format!("inspect legacy master key: {e}")),
  };
  if let Some(key) = saved {
    if legacy.is_some_and(|old| old != key) {
      return Err("Legacy master key differs from the system credential store; migration stopped".into());
    }
    return Ok(key);
  }
  let key = match legacy {
    Some(key) => key,
    None if create => { let mut key = [0u8; 32]; rand::thread_rng().fill_bytes(&mut key); key },
    None => return Err("Credential encryption key is missing from the system credential store".into()),
  };
  store.write(&account, &key)?;
  // Do not discard the legacy key until all records were migrated and the
  // exact same key can be read back from the OS store.
  if store.read(&account)?.as_deref() != Some(key.as_slice()) {
    return Err("System credential store did not preserve the encryption key; migration stopped".into());
  }
  Ok(key)
}

fn master_key(app: &AppHandle, create: bool) -> Result<[u8; 32], String> {
  let _guard = KEY_LOCK.lock();
  master_key_at(&app_data_dir(app)?, &SystemKeyStore, create)
}

pub fn finish_legacy_key_migration(app: &AppHandle) -> Result<(), String> {
  let _guard = KEY_LOCK.lock();
  let dir = app_data_dir(app)?;
  let path = dir.join(KEY_FILE);
  match path.symlink_metadata() {
    Ok(_) => {
      master_key_at(&dir, &SystemKeyStore, false)?;
      fs::remove_file(path).map_err(|e| format!("remove migrated legacy master key: {e}"))?;
    },
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
    Err(e) => return Err(format!("inspect legacy master key: {e}")),
  }
  Ok(())
}

pub fn needs_secret_migration(raw: &str) -> bool { !raw.is_empty() && !raw.starts_with(ENC_PREFIX) }

fn encrypt_with_key(key: &[u8; 32], plain: &str) -> Result<String, String> {
  let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("cipher init: {e}"))?;
  let mut nonce_bytes = [0u8; 12];
  rand::thread_rng().fill_bytes(&mut nonce_bytes);
  let ciphertext = cipher.encrypt(Nonce::from_slice(&nonce_bytes), plain.as_bytes()).map_err(|e| format!("encrypt: {e}"))?;
  let mut packed = Vec::with_capacity(12 + ciphertext.len());
  packed.extend_from_slice(&nonce_bytes);
  packed.extend_from_slice(&ciphertext);
  Ok(format!("{ENC_PREFIX}{}", base64::Engine::encode(&base64::engine::general_purpose::STANDARD, packed)))
}

pub fn encrypt_secret(app: &AppHandle, value: Option<String>) -> Result<Option<String>, String> {
  let Some(plain) = value.filter(|v| !v.is_empty()) else { return Ok(None); };
  // Inputs are always plaintext, including passwords that start with enc:v1:
  // or enc:v2:. Only the persisted *_cipher fields are decoded.
  encrypt_with_key(&master_key(app, true)?, &plain).map(Some)
}

fn decrypt_with_key(key: &[u8; 32], raw: &str) -> Result<String, String> {
  let b64 = raw.strip_prefix(ENC_PREFIX).or_else(|| raw.strip_prefix(LEGACY_ENC_PREFIX)).ok_or("Unknown ciphertext format")?;
  let packed = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64).map_err(|e| format!("decode secret: {e}"))?;
  if packed.len() < 28 { return Err("Secret payload is truncated".into()); }
  let (nonce_bytes, ciphertext) = packed.split_at(12);
  let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("cipher init: {e}"))?;
  let plain = cipher.decrypt(Nonce::from_slice(nonce_bytes), ciphertext).map_err(|_| "Credential ciphertext authentication failed".to_string())?;
  String::from_utf8(plain).map_err(|e| format!("utf8: {e}"))
}

pub fn decrypt_secret(app: &AppHandle, value: Option<&str>) -> Result<Option<String>, String> {
  let Some(raw) = value.filter(|v| !v.is_empty()) else { return Ok(None); };
  if !raw.starts_with(ENC_PREFIX) && !raw.starts_with(LEGACY_ENC_PREFIX) { return Ok(Some(raw.to_string())); }
  decrypt_with_key(&master_key(app, false)?, raw).map(Some)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::cell::RefCell;

  #[derive(Default)]
  struct MemoryKeys(RefCell<Option<Vec<u8>>>);
  impl KeyStore for MemoryKeys {
    fn read(&self, _: &str) -> Result<Option<Vec<u8>>, String> { Ok(self.0.borrow().clone()) }
    fn write(&self, _: &str, bytes: &[u8]) -> Result<(), String> { *self.0.borrow_mut() = Some(bytes.to_vec()); Ok(()) }
  }
  fn directory() -> PathBuf {
    let path = std::env::temp_dir().join(format!("credential-tests-{}", Uuid::new_v4()));
    ensure_private_dir(&path).unwrap(); path
  }

  #[test]
  fn encrypts_prefix_literal_and_authenticates_ciphertext() {
    let key = [7u8; 32];
    for plain in ["enc:v1:not-an-encrypted-password", "enc:v2:a-user-password", "普通密码"] {
      let cipher = encrypt_with_key(&key, plain).unwrap();
      assert_ne!(cipher, plain);
      assert_eq!(decrypt_with_key(&key, &cipher).unwrap(), plain);
      assert!(decrypt_with_key(&[8u8; 32], &cipher).is_err());
    }
  }

  #[test]
  fn legacy_key_migrates_to_os_provider_without_regenerating() {
    let path = directory();
    atomic_private_write(&path.join(KEY_FILE), &[9u8; 32]).unwrap();
    let store = MemoryKeys::default();
    let key = master_key_at(&path, &store, false).unwrap();
    assert_eq!(key, [9u8; 32]);
    assert_eq!(store.0.borrow().as_deref(), Some(key.as_slice()));
    let legacy = encrypt_with_key(&key, "old password").unwrap().replacen(ENC_PREFIX, LEGACY_ENC_PREFIX, 1);
    assert_eq!(decrypt_with_key(&master_key_at(&path, &store, false).unwrap(), &legacy).unwrap(), "old password");
    fs::remove_dir_all(path).unwrap();
  }

  #[test]
  fn lost_or_conflicting_key_refuses_to_decrypt_instead_of_replacing_key() {
    let path = directory();
    let store = MemoryKeys::default();
    assert!(master_key_at(&path, &store, false).is_err());
    assert!(store.0.borrow().is_none());
    atomic_private_write(&path.join(KEY_FILE), &[1u8; 32]).unwrap();
    *store.0.borrow_mut() = Some(vec![2u8; 32]);
    assert!(master_key_at(&path, &store, true).is_err());
    assert_eq!(fs::read(path.join(KEY_FILE)).unwrap(), [1u8; 32]);
    fs::remove_dir_all(path).unwrap();
  }

  #[test]
  fn unavailable_keychain_never_falls_back_to_a_local_key_file() {
    struct Unavailable;
    impl KeyStore for Unavailable {
      fn read(&self, _: &str) -> Result<Option<Vec<u8>>, String> { Err("OS key store locked".into()) }
      fn write(&self, _: &str, _: &[u8]) -> Result<(), String> { panic!("locked store must not be replaced") }
    }
    let path = directory();
    assert!(master_key_at(&path, &Unavailable, true).is_err());
    assert!(!path.join(KEY_FILE).exists());
    atomic_private_write(&path.join(KEY_FILE), &[1u8; 32]).unwrap();
    assert!(master_key_at(&path, &Unavailable, false).is_err());
    assert_eq!(fs::read(path.join(KEY_FILE)).unwrap(), [1u8; 32]);
    fs::remove_dir_all(path).unwrap();
  }

  #[test]
  fn concurrent_key_creation_cannot_publish_ciphertext_under_a_replaced_key() {
    struct ConcurrentCreate(RefCell<usize>);
    impl KeyStore for ConcurrentCreate {
      fn read(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
        let count = *self.0.borrow(); *self.0.borrow_mut() += 1;
        if count == 0 { Ok(None) } else { Ok(Some(vec![44u8; 32])) }
      }
      fn write(&self, _: &str, _: &[u8]) -> Result<(), String> { Ok(()) }
    }
    let path = directory();
    atomic_private_write(&path.join(KEY_FILE), &[55u8; 32]).unwrap();
    assert!(master_key_at(&path, &ConcurrentCreate(RefCell::new(0)), false).is_err());
    assert_eq!(fs::read(path.join(KEY_FILE)).unwrap(), [55u8; 32]);
    fs::remove_dir_all(path).unwrap();
  }

  #[cfg(unix)]
  #[test]
  fn writes_are_private_atomic_and_do_not_follow_symlinks() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let path = directory();
    let file = path.join("connections.json");
    atomic_private_write(&file, b"original").unwrap();
    assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o700);
    assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
    atomic_private_write(&file, b"updated").unwrap();
    assert_eq!(fs::read(&file).unwrap(), b"updated");
    symlink(&file, path.join("link")).unwrap();
    assert!(atomic_private_write(&path.join("link"), b"overwrite").is_err());
    assert_eq!(fs::read(&file).unwrap(), b"updated");
    fs::remove_dir_all(path).unwrap();
  }
}
