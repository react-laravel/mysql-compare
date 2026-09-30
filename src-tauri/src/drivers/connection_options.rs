use crate::types::{ConnectionConfig, DatabaseCredentialConfig, DbEngine};

pub fn configured_databases(connection: &ConnectionConfig) -> Vec<String> {
  let mut databases = Vec::new();
  let mut add = |name: &str| {
    let name = name.trim();
    if !name.is_empty() && !databases.iter().any(|item| item == name) { databases.push(name.to_string()); }
  };
  if let Some(database) = &connection.database { add(database); }
  for database in connection.databases.iter().flatten() { add(database); }
  if let Some(credentials) = &connection.database_credentials {
    let mut names: Vec<_> = credentials.keys().collect();
    names.sort();
    for database in names { add(database); }
  }
  if databases.is_empty() && connection.engine == DbEngine::Postgres {
    databases.push(if connection.username.trim().is_empty() { "postgres" } else { connection.username.trim() }.into());
  }
  databases
}

pub fn show_all_databases(connection: &ConnectionConfig) -> bool {
  connection.show_all_databases.unwrap_or_else(||
    connection.engine != DbEngine::Postgres && configured_databases(connection).is_empty())
}

pub fn credentials<'a>(connection: &'a ConnectionConfig, database: &str) -> (&'a str, &'a str) {
  if let Some(credential) = connection.database_credentials.as_ref().and_then(|items| items.get(database)) {
    if let Some(username) = credential.username.as_deref().filter(|name| !name.trim().is_empty()) {
      return (username, credential.password.as_deref().unwrap_or(""));
    }
  }
  (&connection.username, connection.password.as_deref().unwrap_or(""))
}

/// Empty username explicitly resets to the server account; missing password
/// only reuses a saved password for the same database account.
pub fn resolve_credential(connection: &ConnectionConfig, database: &str, next: DatabaseCredentialConfig) -> Option<DatabaseCredentialConfig> {
  let username = next.username.filter(|name| !name.trim().is_empty())?;
  let previous = connection.database_credentials.as_ref().and_then(|items| items.get(database));
  let password = next.password.or_else(|| previous.filter(|old| old.username.as_deref() == Some(username.as_str())).and_then(|old| old.password.clone()));
  Some(DatabaseCredentialConfig { username: Some(username), password })
}

#[cfg(test)]
mod tests {
  use super::*;
  fn config() -> ConnectionConfig {
    serde_json::from_value(serde_json::json!({ "id":"pg", "engine":"postgres", "name":"test", "host":"localhost", "port":5432, "username":"next", "password":"base", "database":"next", "createdAt":0, "updatedAt":0,
      "databaseCredentials": { "chat": { "username":"chat_user", "password":"chat-secret" } } })).unwrap()
  }
  #[test]
  fn browsing_and_credentials_are_scoped_to_the_database() {
    let connection = config();
    assert!(!show_all_databases(&connection));
    assert_eq!(configured_databases(&connection), ["next", "chat"]);
    assert_eq!(credentials(&connection, "next"), ("next", "base"));
    assert_eq!(credentials(&connection, "chat"), ("chat_user", "chat-secret"));
    assert_eq!(resolve_credential(&connection, "chat", DatabaseCredentialConfig { username: Some("chat_user".into()), password: None }).unwrap().password.as_deref(), Some("chat-secret"));
    assert_eq!(resolve_credential(&connection, "chat", DatabaseCredentialConfig { username: Some("new_user".into()), password: None }).unwrap().password, None);
    assert!(resolve_credential(&connection, "chat", DatabaseCredentialConfig { username: None, password: None }).is_none());
  }
}
