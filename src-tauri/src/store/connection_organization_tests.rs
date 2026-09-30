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
  let store = ConnectionStore { path: directory.join("connections.json"), inner: Mutex::new(Schema { connections }) };
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
