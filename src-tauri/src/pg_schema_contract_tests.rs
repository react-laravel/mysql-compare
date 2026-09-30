use crate::drivers::dialect::{pg_table_key, quote_pg_ident, quote_pg_table};
use crate::{drivers::EngineDriver, export_import, types::*};
use serde_json::json;
use std::sync::{Arc, Mutex};

#[tokio::test]
#[ignore = "requires disposable PostgreSQL; run scripts/test-data-contracts.py"]
async fn scoped_tables_round_trip_and_sync_into_missing_schema() {
  let port: u16 = std::env::var("MYSQL_COMPARE_PG_TEST_PORT")
    .expect("Use the disposable database test runner")
    .parse()
    .unwrap();
  let config: ConnectionConfig = serde_json::from_value(json!({
    "id": "schema-contract", "engine": "postgres", "name": "disposable",
    "host": "127.0.0.1", "port": port, "username": "contract_test",
    "database": "contracts", "createdAt": 0, "updatedAt": 0
  })).unwrap();
  let driver = Arc::new(EngineDriver::open(config.clone(), None).await.unwrap());
  for database in ["schema_source", "schema_target", "schema_import", "schema_existing"] {
    driver.execute_sql(&format!("CREATE DATABASE {database}"), Some("contracts"))
      .await.unwrap();
  }

  let namespace = "scope\"'.\\$schema$.v2";
  let name = "odd\".name";
  let scoped = pg_table_key(namespace, name);
  let public_table = quote_pg_table("public", name);
  let scoped_table = quote_pg_table("public", &scoped);
  driver.execute_sql(&format!(
    "CREATE SCHEMA {}; CREATE TABLE {public_table} (id INTEGER PRIMARY KEY, label TEXT); \
     CREATE TABLE {scoped_table} (id INTEGER PRIMARY KEY, label TEXT, parent_id INTEGER REFERENCES {public_table}(id)); \
     CREATE INDEX {} ON {scoped_table}(label); \
     INSERT INTO {public_table} VALUES (1, 'public'); \
     INSERT INTO {scoped_table} VALUES (1, 'scoped', 1)",
    quote_pg_ident(namespace), quote_pg_ident("idx\".label")
  ), Some("schema_source")).await.unwrap();
  assert_eq!(driver.list_tables_in_schema("schema_source", Some(namespace)).await.unwrap(), [scoped.clone()]);
  assert!(driver.list_foreign_key_edges("schema_source").await.unwrap()
    .contains(&(scoped.clone(), name.into())));
  let request: QueryRowsRequest = serde_json::from_value(json!({
    "connectionId": "schema-contract", "database": "schema_source", "table": scoped,
    "page": 1, "pageSize": 10
  })).unwrap();
  assert_eq!(driver.query_rows(&request).await.unwrap().rows[0]["label"], "scoped");
  assert_eq!(driver.query_rows(&QueryRowsRequest { table: name.into(), ..request.clone() })
    .await.unwrap().rows[0]["label"], "public");

  let imported = export_import::import_table(driver.clone(), &serde_json::from_value(json!({
    "connectionId": "schema-contract", "database": "schema_source", "table": scoped,
    "format": "csv", "fileContent": "id,label,parent_id\n2,imported,1\n", "includeHeaders": true
  })).unwrap(), None).await.unwrap();
  assert_eq!(imported.rows_imported, 1);
  driver.update_row(&serde_json::from_value(json!({
    "connectionId": "schema-contract", "database": "schema_source", "table": scoped,
    "pkValues": {"id": 2}, "changes": {"label": "changed"}
  })).unwrap()).await.unwrap();
  driver.delete_rows(&serde_json::from_value(json!({
    "connectionId": "schema-contract", "database": "schema_source", "table": scoped,
    "pkRows": [{"id": 2}]
  })).unwrap()).await.unwrap();
  assert_eq!(driver.query_rows(&request).await.unwrap().total, 1);

  let copied = driver.copy_table(&CopyTableRequest {
    connection_id: "schema-contract".into(), database: "schema_source".into(),
    table: scoped.clone(), target_table: "copy\".table".into(),
  }).await.unwrap();
  assert_eq!(copied, pg_table_key(namespace, "copy\".table"));
  let renamed = driver.rename_table(&RenameTableRequest {
    connection_id: "schema-contract".into(), database: "schema_source".into(),
    table: copied, new_table: "renamed\".table".into(),
  }).await.unwrap();
  assert_eq!(renamed, pg_table_key(namespace, "renamed\".table"));
  driver.truncate_table(&TruncateTableRequest {
    connection_id: "schema-contract".into(), database: "schema_source".into(),
    table: renamed.clone(), reset_identity: Some(true),
  }).await.unwrap();
  assert_eq!(driver.query_rows(&QueryRowsRequest { table: renamed.clone(), ..request.clone() })
    .await.unwrap().total, 0);
  driver.drop_table(&DropTableRequest {
    connection_id: "schema-contract".into(), database: "schema_source".into(), table: renamed,
  }).await.unwrap();

  // Export and restore both same-named tables, including quoted schemas and indexes.
  // Restore the parent first, as required by the foreign key.
  let mut scoped_export = String::new();
  for table in [name.to_string(), scoped.clone()] {
    let path = std::env::temp_dir().join(format!("pg-schema-contract-{}.sql", uuid::Uuid::new_v4()));
    let export: ExportTableRequest = serde_json::from_value(json!({
      "connectionId": "schema-contract", "database": "schema_source", "table": table,
      "format": "sql", "scope": "all", "includeCreateTable": true
    })).unwrap();
    export_import::export_table(driver.clone(), &export, path.to_str().unwrap()).await.unwrap();
    let sql = std::fs::read_to_string(&path).unwrap();
    std::fs::remove_file(&path).unwrap();
    assert!(!sql.contains('\0'));
    driver.execute_sql(&sql, Some("schema_import")).await.unwrap();
    if table == scoped { scoped_export = sql; }
    let source = driver.query_rows(&QueryRowsRequest { table: table.clone(), ..request.clone() })
      .await.unwrap();
    let restored = driver.query_rows(&QueryRowsRequest {
      database: "schema_import".into(), table, ..request.clone()
    }).await.unwrap();
    assert_eq!(source.rows, restored.rows);
  }

  // The target starts with only public: a structure sync must create the namespace
  // and use full keys when ordering the cross-schema foreign-key dependency.
  let sync: SyncRequest = serde_json::from_value(json!({
    "sourceConnectionId": "schema-contract", "sourceDatabase": "schema_source",
    "targetConnectionId": "schema-contract", "targetDatabase": "schema_target",
    "tables": [scoped, name], "syncStructure": true, "syncData": true, "dryRun": true
  })).unwrap();
  let plan = crate::sync::build_plan(driver.clone(), driver.clone(), &sync).await.unwrap();
  assert!(!plan.steps.iter().flat_map(|step| &step.sqls).any(|sql| sql.contains('\0')));
  let execute = SyncRequest { dry_run: Some(false), plan_id: plan.plan_id, ..sync };
  let errors = Mutex::new(Vec::new());
  let counts = crate::sync::execute_with_progress(&|event| {
    assert!(!event.message.as_deref().unwrap_or_default().contains('\0'));
    if event.level == "error" { errors.lock().unwrap().push(event.message); }
  }, driver.clone(), driver.clone(), &execute).await.unwrap();
  assert_eq!(counts, (2, 0), "{:?}", errors.lock().unwrap());
  assert_eq!(driver.query_rows(&QueryRowsRequest {
    database: "schema_target".into(), ..request.clone()
  }).await.unwrap().rows, driver.query_rows(&request).await.unwrap().rows);
  let comparison = crate::diff::diff_table(driver.clone(), "schema_source", driver.clone(),
    "schema_target", &scoped, true).await.unwrap();
  assert!(comparison.table_diff.is_none());
  let data = comparison.row_comparison.unwrap().data_diff;
  assert_eq!((data.identical, data.source_only, data.target_only, data.modified), (1, 0, 0, 0));

  // An existing schema must work with schema CREATE alone, without database CREATE.
  driver.execute_sql(&format!(
    "CREATE ROLE schema_writer LOGIN; CREATE SCHEMA {}; \
     CREATE TABLE {public_table} (id INTEGER PRIMARY KEY, label TEXT); \
     INSERT INTO {public_table} VALUES (1, 'public'); \
     GRANT USAGE, CREATE ON SCHEMA {} TO schema_writer; \
     GRANT SELECT, REFERENCES ON {public_table} TO schema_writer",
    quote_pg_ident(namespace), quote_pg_ident(namespace)
  ), Some("schema_existing")).await.unwrap();
  let target = Arc::new(EngineDriver::open(ConnectionConfig {
    username: "schema_writer".into(), database: Some("schema_existing".into()), ..config
  }, None).await.unwrap());
  let sync = SyncRequest {
    target_database: "schema_existing".into(), tables: vec![scoped.clone()],
    dry_run: Some(true), plan_id: None, ..execute
  };
  let plan = crate::sync::build_plan(driver.clone(), target.clone(), &sync).await.unwrap();
  assert!(plan.steps.iter().flat_map(|step| &step.sqls).all(|sql| !sql.starts_with("CREATE SCHEMA")));
  let execute = SyncRequest { dry_run: Some(false), plan_id: plan.plan_id, ..sync };
  let counts = crate::sync::execute_with_progress(&|event| {
    assert_ne!(event.level, "error", "{:?}", event.message);
  }, driver.clone(), target.clone(), &execute).await.unwrap();
  assert_eq!(counts, (1, 0));
  assert_eq!(target.query_rows(&QueryRowsRequest {
    database: "schema_existing".into(), ..request.clone()
  }).await.unwrap().rows, driver.query_rows(&request).await.unwrap().rows);
  target.drop_table(&DropTableRequest {
    connection_id: "schema-contract".into(), database: "schema_existing".into(), table: scoped.clone(),
  }).await.unwrap();
  export_import::import_table(target.clone(), &serde_json::from_value(json!({
    "connectionId": "schema-contract", "database": "schema_existing", "table": scoped,
    "format": "sql", "fileContent": scoped_export
  })).unwrap(), None).await.unwrap();
  assert_eq!(target.query_rows(&QueryRowsRequest {
    database: "schema_existing".into(), ..request.clone()
  }).await.unwrap().rows, driver.query_rows(&request).await.unwrap().rows);
  target.close().await;
  driver.close().await;
}
