use super::*;

fn fixture() -> ConnectionStore {
  let directory = std::env::temp_dir().join(format!("connection-order-{}", Uuid::new_v4()));
  fs::create_dir(&directory).unwrap();
  let connections = ["first", "second"].into_iter().map(|id| {
    serde_json::from_value(serde_json::json!({
      "id": id, "engine": "postgres", "name": id, "group": "old",
      "host": "127.0.0.1", "port": 5432, "username": id, "database": id,
      "useSSH": true, "sshHost": "example.test", "sshPort": 22,
      "createdAt": 1, "updatedAt": 2,
      "passwordCipher": "preserve-password-cipher", "sshPrivateKeyCipher": "preserve-key-cipher",
      "databaseCredentials": { "app": { "username": "custom", "passwordCipher": "preserve-db-cipher" } }
    })).unwrap()
  }).collect();
  let store = ConnectionStore { path: directory.join("connections.json"), inner: Mutex::new(Schema { connections }), startup_error: None };
  store.persist(&store.inner.lock()).unwrap();
  store
}

fn item(id: &str, group: &str) -> ConnectionOrganizationItem {
  ConnectionOrganizationItem { id: id.into(), group: Some(group.into()) }
}

#[test]
fn organization_persists_order_and_groups_without_touching_credentials() {
  let store = fixture();
  let before: HashMap<_, _> = store.inner.lock().connections.iter()
    .map(|c| (c.id.clone(), serde_json::to_value(c).unwrap())).collect();
  let result = store.organize(vec![item("second", " Shared host "), item("first", " ")]).unwrap();
  assert_eq!(result.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), vec!["second", "first"]);
  assert_eq!(result[0].group.as_deref(), Some("Shared host"));
  assert_eq!(result[1].group, None);
  let reopened: Schema = serde_json::from_slice(&fs::read(&store.path).unwrap()).unwrap();
  assert_eq!(reopened.connections[0].id, "second");
  for connection in &reopened.connections {
    let mut persisted = serde_json::to_value(connection).unwrap();
    persisted["group"] = before[&connection.id]["group"].clone();
    assert_eq!(persisted, before[&connection.id]);
  }
  fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
}

#[test]
fn organization_rejects_stale_or_duplicate_lists_without_partial_changes() {
  let store = fixture();
  let before = fs::read(&store.path).unwrap();
  for items in [vec![item("first", "new")], vec![item("first", "new"), item("first", "new")],
    vec![item("first", "new"), item("unknown", "new")]] {
    assert_eq!(store.organize(items).unwrap_err(), "CONNECTION_LIST_CHANGED");
    assert_eq!(fs::read(&store.path).unwrap(), before);
    assert_eq!(store.list_safe()[0].group.as_deref(), Some("old"));
  }
  fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
}

#[test]
fn organization_keeps_memory_unchanged_if_persistence_fails() {
  let mut store = fixture();
  let directory = store.path.parent().unwrap().to_path_buf();
  store.path = directory.join("missing").join("connections.json");
  assert!(store.organize(vec![item("second", "new"), item("first", "new")]).is_err());
  assert_eq!(store.list_safe()[0].id, "first");
  assert_eq!(store.list_safe()[0].group.as_deref(), Some("old"));
  fs::remove_dir_all(directory).unwrap();
}

#[test]
fn migration_covers_database_and_all_ssh_credentials_without_exposing_current_ciphertexts() {
  let store = fixture();
  let mut schema = store.inner.lock().clone();
  schema.connections[0].ssh_password_cipher = Some("legacy-ssh-password".into());
  schema.connections[0].ssh_passphrase_cipher = Some("legacy-passphrase".into());
  schema.connections[1].password_cipher = Some("enc:v2:already-current".into());
  let mut migrated = Vec::new();
  assert!(migrate_stored_secrets(&mut schema, |value| {
    let plain = value.unwrap();
    migrated.push(plain.to_string());
    Ok(Some(format!("enc:v2:migrated-{plain}")))
  }).unwrap());
  for expected in ["legacy-ssh-password", "legacy-passphrase", "preserve-key-cipher", "preserve-db-cipher", "preserve-password-cipher"] {
    assert!(migrated.iter().any(|plain| plain == expected));
  }
  assert_eq!(schema.connections[1].password_cipher.as_deref(), Some("enc:v2:already-current"));
  assert!(!migrate_stored_secrets(&mut schema, |_| panic!("current ciphertext must not be treated as plaintext")).unwrap());
  fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
}

#[test]
fn connection_removal_keeps_memory_unchanged_if_persistence_fails() {
  let mut store = fixture();
  let directory = store.path.parent().unwrap().to_path_buf();
  store.path = directory.join("missing").join("connections.json");
  assert!(store.remove("first").is_err());
  assert_eq!(store.list_safe().len(), 2);
  fs::remove_dir_all(directory).unwrap();
}
#[test]
fn unavailable_credential_migration_preserves_safe_listing_and_refuses_persistence() {
  let mut store = fixture();
  let original = fs::read(&store.path).unwrap();
  store.startup_error = Some("System credential store locked; migration stopped".into());
  assert_eq!(store.list_safe().len(), 2);
  assert!(store.organize(vec![item("second", "new"), item("first", "new")]).is_err());
  assert!(store.remove("first").is_err());
  assert_eq!(fs::read(&store.path).unwrap(), original);
  assert_eq!(store.list_safe()[0].id, "first");
  fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
}
