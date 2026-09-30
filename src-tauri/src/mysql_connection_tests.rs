use crate::{drivers::EngineDriver, types::*};
use serde_json::json;

#[tokio::test]
#[ignore = "requires disposable MySQL; run scripts/test-data-contracts.py"]
async fn metadata_discovery_preserves_table_names_and_foreign_keys() {
  let port: u16 = std::env::var("MYSQL_COMPARE_MYSQL_TEST_PORT")
    .unwrap()
    .parse()
    .unwrap();
  let config: ConnectionConfig = serde_json::from_value(json!({
    "id": "mysql-metadata-admin", "engine": "mysql", "name": "disposable",
    "host": "127.0.0.1", "port": port, "username": "root",
    "database": "contracts", "createdAt": 0, "updatedAt": 0
  }))
  .unwrap();
  let driver = EngineDriver::open(config, None).await.unwrap();
  driver
    .execute_sql(
      "CREATE DATABASE mysql_metadata_scope; \
       CREATE DATABASE mysql_metadata_other; \
       CREATE TABLE mysql_metadata_scope.`z_parents_é` (id INT, part INT, PRIMARY KEY (id, part)); \
       CREATE TABLE mysql_metadata_scope.`a_children_é` (id INT PRIMARY KEY, parent_id INT, parent_part INT, \
         FOREIGN KEY (parent_id, parent_part) REFERENCES mysql_metadata_scope.`z_parents_é` (id, part)); \
       CREATE VIEW mysql_metadata_scope.metadata_view AS SELECT id FROM mysql_metadata_scope.`z_parents_é`; \
       CREATE TABLE mysql_metadata_other.unrelated (id INT PRIMARY KEY); \
       CREATE TABLE mysql_metadata_scope.external_reference (id INT PRIMARY KEY, \
         FOREIGN KEY (id) REFERENCES mysql_metadata_other.unrelated (id))",
      None,
    )
    .await
    .unwrap();

  let databases = driver.discover_databases().await.unwrap();
  assert!(databases.contains(&"mysql_metadata_scope".to_string()));
  assert!(databases.contains(&"mysql_metadata_other".to_string()));
  for system in ["information_schema", "performance_schema", "mysql", "sys"] {
    assert!(!databases.iter().any(|name| name == system));
  }
  // Binary-flagged metadata on case-sensitive MySQL must not disappear. Keep
  // Unicode names intact, exclude views and other databases, and deduplicate
  // composite foreign keys without including cross-database dependencies.
  let mut tables = driver.list_tables("mysql_metadata_scope").await.unwrap();
  tables.sort();
  assert_eq!(tables, vec!["a_children_é", "external_reference", "z_parents_é"]);
  assert_eq!(
    driver.list_tables("mysql_metadata_other").await.unwrap(),
    vec!["unrelated"]
  );
  assert_eq!(
    driver.list_foreign_key_edges("mysql_metadata_scope").await.unwrap(),
    vec![("a_children_é".to_string(), "z_parents_é".to_string())]
  );
  driver.close().await;
}

#[tokio::test]
#[ignore = "requires disposable MySQL; run scripts/test-data-contracts.py"]
async fn server_probe_and_database_credentials_have_separate_scopes() {
  let port: u16 = std::env::var("MYSQL_COMPARE_MYSQL_TEST_PORT")
    .unwrap()
    .parse()
    .unwrap();
  let admin_config: ConnectionConfig = serde_json::from_value(json!({
    "id": "mysql-probe-admin", "engine": "mysql", "name": "disposable",
    "host": "127.0.0.1", "port": port, "username": "root",
    "database": "contracts", "createdAt": 0, "updatedAt": 0
  }))
  .unwrap();
  let admin = EngineDriver::open(admin_config.clone(), None)
    .await
    .unwrap();
  admin
    .execute_sql(
      "CREATE DATABASE mysql_probe_scope; \
     CREATE TABLE mysql_probe_scope.visible (id INT PRIMARY KEY); \
     INSERT INTO mysql_probe_scope.visible VALUES (7); \
     CREATE USER 'mysql_probe_base'@'%' IDENTIFIED BY 'base-test-password'; \
     CREATE USER 'mysql_probe_scoped'@'%' IDENTIFIED BY 'scoped-test-password'; \
     GRANT SELECT ON mysql_probe_scope.* TO 'mysql_probe_scoped'@'%'",
      None,
    )
    .await
    .unwrap();

  let mut connection = admin_config;
  connection.username = "mysql_probe_base".into();
  connection.password = Some("base-test-password".into());
  for database in ["mysql_probe_missing", "mysql_probe_scope"] {
    connection.database = Some(database.into());
    // A valid server account can be tested even without access to the default DB.
    assert!(EngineDriver::test_connection(&connection, None)
      .await
      .unwrap()
      .starts_with("OK · MySQL"));
    assert!(EngineDriver::test_database_connection(&connection, None)
      .await
      .is_err());
  }

  connection.database_credentials = Some(std::collections::HashMap::from([(
    "mysql_probe_scope".into(),
    DatabaseCredentialConfig {
      username: Some("mysql_probe_scoped".into()),
      password: Some("scoped-test-password".into()),
    },
  )]));
  assert!(EngineDriver::test_database_connection(&connection, None)
    .await
    .is_ok());
  let scoped = EngineDriver::open(connection.clone(), None).await.unwrap();
  let info = scoped.get_database_info("mysql_probe_scope").await.unwrap();
  assert_eq!(info.name, "mysql_probe_scope");
  assert_eq!(info.table_count, 1);
  assert_eq!(
    scoped.list_tables("mysql_probe_scope").await.unwrap(),
    vec!["visible"]
  );
  let user = scoped
    .execute_sql(
      "SELECT CURRENT_USER() AS username",
      Some("mysql_probe_scope"),
    )
    .await
    .unwrap();
  assert_eq!(user["rows"][0]["username"], "mysql_probe_scoped@%");
  scoped.close().await;

  connection.password = Some("wrong-base-password".into());
  // A valid database override must never mask bad server credentials.
  assert!(EngineDriver::test_connection(&connection, None)
    .await
    .is_err());
  assert!(EngineDriver::test_database_connection(&connection, None)
    .await
    .is_ok());
  connection.password = Some("base-test-password".into());
  connection
    .database_credentials
    .as_mut()
    .unwrap()
    .get_mut("mysql_probe_scope")
    .unwrap()
    .password = Some("wrong-scoped-password".into());
  assert!(EngineDriver::test_connection(&connection, None)
    .await
    .is_ok());
  assert!(EngineDriver::test_database_connection(&connection, None)
    .await
    .is_err());
  let bad_scope = EngineDriver::open(connection.clone(), None).await.unwrap();
  assert!(bad_scope
    .get_database_info("mysql_probe_scope")
    .await
    .is_err());
  bad_scope.close().await;

  connection.database_credentials = None;
  connection.username = "root".into();
  connection.password = None;
  connection.database = Some("mysql_probe_missing".into());
  // A privileged account still cannot pass the database probe for a missing DB.
  assert!(EngineDriver::test_connection(&connection, None)
    .await
    .is_ok());
  assert!(EngineDriver::test_database_connection(&connection, None)
    .await
    .unwrap_err()
    .contains("Unknown database"));
  admin.close().await;
}
