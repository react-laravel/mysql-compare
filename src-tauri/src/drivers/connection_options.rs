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

/// Never silently downgrade a remote direct connection. SQLx couples its TCP
/// endpoint and certificate name, so explicit TLS through an SSH loopback
/// endpoint is refused instead of verifying the wrong host or skipping checks.
pub fn verified_tls(connection: &ConnectionConfig, local_port: Option<u16>) -> Result<bool, String> {
  use crate::types::TlsMode;
  let mode = connection.tls_mode.unwrap_or(TlsMode::Auto);
  if mode == TlsMode::VerifyFull && (local_port.is_some() || connection.use_ssh) {
    return Err("Verified database TLS through SSH is not supported by this driver. Use SSH with Automatic transport, or connect directly with verified TLS.".into());
  }
  if connection.tls_ca_pem.as_ref().is_some_and(|pem| pem.len() > 1024 * 1024) {
    return Err("CA certificate exceeds 1 MiB".into());
  }
  Ok(match mode {
    TlsMode::Disabled => false,
    TlsMode::VerifyFull => true,
    TlsMode::Auto => local_port.is_none() && !connection.use_ssh && !is_loopback_host(&connection.host),
  })
}

pub fn is_loopback_host(host: &str) -> bool {
  let host = host.trim().trim_start_matches('[').trim_end_matches(']');
  host.eq_ignore_ascii_case("localhost") || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// Bounded cache eviction removes one oldest entry rather than invalidating all
/// other tables whenever a connection browses its 129th table.
pub fn cache_schema(cache: &mut std::collections::HashMap<(String, String), (std::time::Instant, crate::types::TableSchema)>, key: (String, String), schema: crate::types::TableSchema) {
  if cache.len() >= 128 && !cache.contains_key(&key) {
    if let Some(oldest) = cache.iter().min_by_key(|(_, (at, _))| *at).map(|(key, _)| key.clone()) { cache.remove(&oldest); }
  }
  cache.insert(key, (std::time::Instant::now(), schema));
}

#[cfg(test)]
mod tls_tests {
  use super::*;
  use crate::types::TlsMode;
  fn config(host: &str) -> ConnectionConfig {
    serde_json::from_value(serde_json::json!({"id":"tls","name":"TLS","host":host,"port":3306,"username":"u","createdAt":0,"updatedAt":0})).unwrap()
  }
  #[test]
  fn a_full_schema_cache_evicts_only_one_oldest_table() {
    let schema: crate::types::TableSchema = serde_json::from_value(serde_json::json!({"name":"table", "columns":[],"indexes":[],"primaryKey":[],"createSQL":""})).unwrap();
    let mut cache = std::collections::HashMap::new();
    for index in 0..128 { cache_schema(&mut cache, ("db".into(), index.to_string()), schema.clone()); }
    cache_schema(&mut cache, ("db".into(), "64".into()), schema.clone());
    assert_eq!(cache.len(), 128);
    cache_schema(&mut cache, ("db".into(), "128".into()), schema);
    assert_eq!(cache.len(), 128);
    assert!(!cache.contains_key(&("db".into(), "0".into())));
    assert!(cache.contains_key(&("db".into(), "64".into())));
    assert!(cache.contains_key(&("db".into(), "127".into())));
  }

  #[test]
  fn remote_tls_does_not_downgrade_and_local_transport_is_explicit() {
    for host in ["db.example.com", "192.168.1.2", "localhost.example.com", "::", "0.0.0.0"] { assert!(verified_tls(&config(host), None).unwrap()); }
    for host in ["localhost", "LOCALHOST", "127.0.0.1", "127.1.2.3", "::1", "[::1]"] { assert!(!verified_tls(&config(host), None).unwrap()); }
    let mut c = config("db.example.com");
    assert!(!verified_tls(&c, Some(1234)).unwrap());
    c.tls_mode = Some(TlsMode::VerifyFull);
    assert!(verified_tls(&c, Some(1234)).is_err());
    assert!(verified_tls(&c, None).unwrap());
    c.tls_mode = Some(TlsMode::Disabled);
    assert!(!verified_tls(&c, None).unwrap());
  }
}

/// Return completed queries to the pool, but close sockets if their owning
/// future is canceled, times out, or fails before it consumes the protocol.
pub struct ActiveConnection<DB: sqlx::Database> {
  inner: Option<sqlx::pool::PoolConnection<DB>>,
  cancellation: Option<Box<dyn FnOnce() + Send>>,
}
impl<DB: sqlx::Database> ActiveConnection<DB> {
  pub fn new(connection: sqlx::pool::PoolConnection<DB>) -> Self { Self { inner: Some(connection), cancellation: None } }
  pub fn on_cancel(&mut self, callback: impl FnOnce() + Send + 'static) { self.cancellation = Some(Box::new(callback)); }
  pub fn complete(mut self) { self.cancellation.take(); drop(self.inner.take()); }
  #[cfg(test)]
  pub async fn complete_and_wait(mut self) {
    // Tests that deliberately change session state must await SQLx's return
    // ping, otherwise the next acquisition can legitimately open a new socket.
    self.cancellation.take();
    if let Some(mut connection) = self.inner.take() { connection.return_to_pool().await; }
  }
}
impl<DB: sqlx::Database> std::ops::Deref for ActiveConnection<DB> {
  type Target = DB::Connection;
  fn deref(&self) -> &Self::Target { &**self.inner.as_ref().expect("active connection") }
}
impl<DB: sqlx::Database> std::ops::DerefMut for ActiveConnection<DB> {
  fn deref_mut(&mut self) -> &mut Self::Target { &mut **self.inner.as_mut().expect("active connection") }
}
impl<DB: sqlx::Database> Drop for ActiveConnection<DB> {
  fn drop(&mut self) {
    if let Some(callback) = self.cancellation.take() { callback(); }
    if let Some(connection) = self.inner.as_mut() { connection.close_on_drop(); }
  }
}
