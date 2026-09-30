//! These tests only run against disposable servers created by scripts/test-data-contracts.py.
#[path = "pg_schema_contract_tests.rs"]
mod pg_schema_contract_tests;

#[path = "mysql_connection_tests.rs"]
mod mysql_connection_tests;

use crate::{drivers::EngineDriver, export_import, types::*};
use serde_json::json;
use std::sync::Arc;

async fn contracts(engine: &str, port_var: &str) {
  let port: u16 = std::env::var(port_var)
    .expect("Use the disposable database test runner")
    .parse()
    .unwrap();
  let config: ConnectionConfig = serde_json::from_value(json!({
    "id": engine, "engine": engine, "name": "disposable contract test", "host": "127.0.0.1", "port": port,
    "username": if engine == "mysql" { "root" } else { "contract_test" }, "database": "contracts", "createdAt": 0, "updatedAt": 0
  })).unwrap();
  let driver = Arc::new(EngineDriver::open(config, None).await.unwrap());
  let ddl = if engine == "mysql" {
    "CREATE TABLE items (id BIGINT PRIMARY KEY, amount DECIMAL(30,10), label TEXT, happened DATETIME(6), data BLOB, payload JSON); CREATE INDEX amount_idx ON items(amount)"
  } else {
    "CREATE TABLE items (id BIGINT PRIMARY KEY, amount NUMERIC(30,10), label TEXT, happened TIMESTAMP(6), data BYTEA, payload JSONB); CREATE INDEX amount_idx ON items(amount)"
  };
  driver.execute_sql(ddl, Some("contracts")).await.unwrap();
  assert!(driver
    .list_tables("contracts")
    .await
    .unwrap()
    .contains(&"items".to_string()));
  for id in [1, 2, 3, 9_007_199_254_740_993i64] {
    driver.insert_row(&serde_json::from_value(json!({
      "connectionId": engine, "database": "contracts", "table": "items",
      "values": { "id": id.to_string(), "amount": "12345678901234567890.1234567890", "label": " spaced,\n\"quoted\"\\ ", "happened": "2026-09-08 01:02:03.123456", "data": {"type": "Buffer", "hex": "00ff0102"}, "payload": {"a": 1, "b": null} }
    })).unwrap()).await.unwrap();
  }
  let req: QueryRowsRequest = serde_json::from_value(json!({ "connectionId": engine, "database": "contracts", "table": "items", "page": 1, "pageSize": 2 })).unwrap();
  let first = driver.query_rows(&req).await.unwrap();
  assert_eq!(first.total, 4);
  assert_eq!(first.rows.len(), 2);
  assert_eq!(first.rows[0]["amount"], "12345678901234567890.1234567890");
  assert_eq!(
    first.rows[0]["data"],
    json!({"type":"Buffer", "hex":"00ff0102"})
  );
  assert_eq!(first.rows[0]["happened"], "2026-09-08 01:02:03.123456");
  let keyed = driver
    .query_rows(&QueryRowsRequest {
      key_rows: Some(vec![serde_json::from_value(
        json!({"id":"9007199254740993"}),
      )
      .unwrap()]),
      ..req.clone()
    })
    .await
    .unwrap();
  assert_eq!(keyed.rows.len(), 1);
  assert_eq!(keyed.rows[0]["id"], "9007199254740993");
  let sql_result = driver
    .execute_sql(
      "SELECT id, amount FROM items ORDER BY id",
      Some("contracts"),
    )
    .await
    .unwrap();
  assert_eq!(sql_result["rows"].as_array().unwrap().len(), 4);

  let schema = driver.get_table_schema("contracts", "items").await.unwrap();
  assert!(schema
    .indexes
    .iter()
    .any(|index| index.name == "amount_idx"));
  assert!(!schema.create_sql.contains("..."));
  driver
    .execute_sql(
      &schema
        .create_sql
        .replace("items", "items_copy")
        .replace("amount_idx", "copy_amount_idx"),
      Some("contracts"),
    )
    .await
    .unwrap();
  driver
    .insert_row(&InsertRowRequest {
      connection_id: engine.into(),
      database: "contracts".into(),
      table: "items_copy".into(),
      values: keyed.rows[0].clone(),
    })
    .await
    .unwrap();
  assert_eq!(
    driver
      .query_rows(&QueryRowsRequest {
        table: "items_copy".into(),
        ..req.clone()
      })
      .await
      .unwrap()
      .rows,
    keyed.rows
  );

  let path = std::env::temp_dir().join(format!(
    "mysql-compare-contract-{}.sql",
    uuid::Uuid::new_v4()
  ));
  for (scope, count) in [("all", 4), ("filtered", 2), ("page", 1), ("selected", 1)] {
    let export: ExportTableRequest = serde_json::from_value(json!({
      "connectionId": engine, "database": "contracts", "table": "items", "format": "sql", "scope": scope,
      "sqlDialect": "source", "where": "id <= 2", "orderBy": { "column": "id", "dir": "DESC" }, "page": 2, "pageSize": 1,
      "selectedRows": [keyed.rows[0]], "includeCreateTable": false
    })).unwrap();
    let result = export_import::export_table(driver.clone(), &export, path.to_str().unwrap())
      .await
      .unwrap();
    assert_eq!(result.rows_exported, count, "scope {scope}");
    let sql = std::fs::read_to_string(&path).unwrap();
    if engine == "postgres" {
      assert!(!sql.contains('`'));
    }
    driver
      .execute_sql("DELETE FROM items_copy", Some("contracts"))
      .await
      .unwrap();
    driver
      .execute_sql(
        &sql
          .replace("INSERT INTO `items`", "INSERT INTO `items_copy`")
          .replace("INSERT INTO \"items\"", "INSERT INTO \"items_copy\""),
        Some("contracts"),
      )
      .await
      .unwrap();
    assert_eq!(
      driver
        .query_rows(&QueryRowsRequest {
          table: "items_copy".into(),
          ..req.clone()
        })
        .await
        .unwrap()
        .total,
      count
    );
  }
  let _ = std::fs::remove_file(path);

  // Exercise repartitioning on a large, sparse key space, independent of DB collation.
  driver
    .execute_sql("CREATE DATABASE contracts_target", Some("contracts"))
    .await
    .unwrap();
  driver
    .execute_sql(&schema.create_sql, Some("contracts_target"))
    .await
    .unwrap();
  assert_eq!(
    driver.list_tables("contracts_target").await.unwrap(),
    vec!["items".to_string()]
  );
  for row in &first.rows {
    let mut values = row.clone();
    if values["id"] == 2 {
      values.insert("label".into(), json!("changed"));
    }
    driver
      .insert_row(&InsertRowRequest {
        connection_id: engine.into(),
        database: "contracts_target".into(),
        table: "items".into(),
        values,
      })
      .await
      .unwrap();
  }
  driver
    .execute_sql(
      "INSERT INTO items (id) VALUES (999999)",
      Some("contracts_target"),
    )
    .await
    .unwrap();
  for batch in 0..100 {
    let values = (0..1000)
      .map(|index| format!("({})", 100 + batch * 1000 + index))
      .collect::<Vec<_>>()
      .join(",");
    driver
      .execute_sql(
        &format!("INSERT INTO items (id) VALUES {values}"),
        Some("contracts"),
      )
      .await
      .unwrap();
  }
  let comparison = crate::diff::diff_table(
    driver.clone(),
    "contracts",
    driver.clone(),
    "contracts_target",
    "items",
    true,
  )
  .await
  .unwrap();
  let data = comparison.row_comparison.unwrap().data_diff;
  assert!(data.comparable);
  assert_eq!((data.source_row_count, data.target_row_count), (100004, 3));
  assert_eq!(
    (
      data.identical,
      data.modified,
      data.source_only,
      data.target_only
    ),
    (1, 1, 100002, 1)
  );
  let sync: SyncRequest = serde_json::from_value(json!({
    "sourceConnectionId": engine, "sourceDatabase": "contracts", "targetConnectionId": engine, "targetDatabase": "contracts_target", "tables": ["items"],
    "syncStructure": false, "syncData": true, "existingTableStrategy": "truncate-and-import", "dryRun": true
  })).unwrap();
  let plan = crate::sync::build_plan(driver.clone(), driver.clone(), &sync)
    .await
    .unwrap();
  assert!(plan.plan_id.is_some());
  assert!(plan.steps[0].sqls.join("\n").contains("limited to 50"));
  let altered = SyncRequest {
    dry_run: Some(false),
    plan_id: plan.plan_id.clone(),
    existing_table_strategy: Some("overwrite-structure".into()),
    ..sync.clone()
  };
  assert!(
    crate::sync::execute_with_progress(&|_| {}, driver.clone(), driver.clone(), &altered)
      .await
      .is_err()
  );
  assert_eq!(
    driver
      .query_rows(&QueryRowsRequest {
        database: "contracts_target".into(),
        ..req.clone()
      })
      .await
      .unwrap()
      .total,
    3
  );
  let refreshed = crate::sync::build_plan(driver.clone(), driver.clone(), &sync)
    .await
    .unwrap();
  let execute = SyncRequest {
    dry_run: Some(false),
    plan_id: refreshed.plan_id,
    task_id: Some("contract-sync".into()),
    ..sync
  };
  let events = std::sync::Mutex::new(Vec::new());
  let collect = |event| events.lock().unwrap().push(event);
  let result =
    crate::sync::execute_with_progress(&collect, driver.clone(), driver.clone(), &execute)
      .await
      .unwrap();
  assert_eq!(result, (1, 0));
  assert!(events
    .lock()
    .unwrap()
    .iter()
    .all(|event| event.task_id.as_deref() == Some("contract-sync")));
  assert_eq!(
    driver
      .query_rows(&QueryRowsRequest {
        database: "contracts_target".into(),
        ..req.clone()
      })
      .await
      .unwrap()
      .total,
    100004
  );
  assert!(
    crate::sync::execute_with_progress(&|_| {}, driver.clone(), driver.clone(), &execute)
      .await
      .is_err()
  );
  driver.close().await;
}

#[tokio::test]
#[ignore = "requires disposable MySQL; run scripts/test-data-contracts.py"]
async fn mysql_data_contracts() {
  contracts("mysql", "MYSQL_COMPARE_MYSQL_TEST_PORT").await;
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL; run scripts/test-data-contracts.py"]
async fn postgres_data_contracts() {
  contracts("postgres", "MYSQL_COMPARE_PG_TEST_PORT").await;
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL from scripts/test-data-contracts.py"]
async fn postgres_browsing_data_contracts() {
  use crate::drivers::dialect::{pg_table_key, quote_pg_table};
  let port: u16 = std::env::var("MYSQL_COMPARE_PG_TEST_PORT").unwrap().parse().unwrap();
  let admin_config: ConnectionConfig = serde_json::from_value(json!({ "id":"browse-admin", "engine":"postgres", "name":"disposable", "host":"127.0.0.1", "port":port, "username":"contract_test", "database":"contracts", "createdAt":0, "updatedAt":0 })).unwrap();
  let admin = EngineDriver::open(admin_config.clone(), None).await.unwrap();
  admin.execute_sql("SET password_encryption = 'scram-sha-256'; CREATE ROLE browse_user LOGIN PASSWORD 'browse-test-password'; CREATE ROLE browse_other_user LOGIN PASSWORD 'other-test-password'", Some("contracts")).await.unwrap();
  for database in ["browse_main", "browse_other"] {
    admin.execute_sql(&format!("CREATE DATABASE {database}"), Some("contracts")).await.unwrap();
  }
  admin.execute_sql("CREATE TABLE same_name (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO same_name VALUES (1, 'public'); CREATE SCHEMA \"sales.v2\"; CREATE TABLE \"sales.v2\".same_name (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO \"sales.v2\".same_name VALUES (1, 'private'); GRANT ALL ON public.same_name, \"sales.v2\".same_name TO browse_user; GRANT USAGE, CREATE ON SCHEMA \"sales.v2\" TO browse_user", Some("browse_main")).await.unwrap();
  admin.execute_sql("CREATE TABLE confidential (id INTEGER PRIMARY KEY); INSERT INTO confidential VALUES (7); GRANT SELECT ON confidential TO browse_other_user", Some("browse_other")).await.unwrap();
  let mut base = admin_config.clone();
  base.username = "browse_user".into();
  base.password = Some("browse-test-password".into());
  base.database = Some("browse_main".into());
  let driver = Arc::new(EngineDriver::open(base.clone(), None).await.unwrap());
  assert_eq!(driver.list_databases().await.unwrap(), ["browse_main"]);
  assert!(driver.discover_databases().await.unwrap().contains(&"browse_other".into()));
  assert!(driver.list_tables("browse_other").await.unwrap().is_empty());
  assert!(driver.list_schemas("browse_main").await.unwrap().contains(&"sales.v2".into()));
  let scoped = pg_table_key("sales.v2", "same_name");
  assert_eq!(driver.list_tables_in_schema("browse_main", Some("sales.v2")).await.unwrap(), [scoped.clone()]);
  let request: QueryRowsRequest = serde_json::from_value(json!({ "connectionId":"browse", "database":"browse_main", "table":scoped, "page":1, "pageSize":10 })).unwrap();
  assert_eq!(driver.query_rows(&request).await.unwrap().rows[0]["label"], "private");
  assert_eq!(driver.query_rows(&QueryRowsRequest { table:"same_name".into(), ..request.clone() }).await.unwrap().rows[0]["label"], "public");
  driver.update_row(&serde_json::from_value(json!({ "connectionId":"browse", "database":"browse_main", "table":scoped, "pkValues": {"id":1}, "changes":{"label":"changed-private"} })).unwrap()).await.unwrap();
  assert_eq!(driver.query_rows(&request).await.unwrap().rows[0]["label"], "changed-private");
  assert_eq!(driver.query_rows(&QueryRowsRequest { table:"same_name".into(), ..request.clone() }).await.unwrap().rows[0]["label"], "public");
  let copy = driver.copy_table(&CopyTableRequest { connection_id:"browse".into(), database:"browse_main".into(), table:scoped.clone(), target_table:"copy".into() }).await.unwrap();
  assert_eq!(copy, pg_table_key("sales.v2", "copy"));
  let renamed = driver.rename_table(&RenameTableRequest { connection_id:"browse".into(), database:"browse_main".into(), table:copy, new_table:"renamed".into() }).await.unwrap();
  assert_eq!(renamed, pg_table_key("sales.v2", "renamed"));
  let path = std::env::temp_dir().join(format!("scoped-export-{}.sql", uuid::Uuid::new_v4()));
  let export: ExportTableRequest = serde_json::from_value(json!({ "connectionId":"browse", "database":"browse_main", "table":scoped, "format":"sql", "scope":"all", "includeCreateTable":false })).unwrap();
  export_import::export_table(driver.clone(), &export, path.to_str().unwrap()).await.unwrap();
  let sql = std::fs::read_to_string(&path).unwrap();
  assert!(sql.contains(&format!("INSERT INTO {}", quote_pg_table("public", &scoped))));
  assert!(!sql.contains('\0'));
  std::fs::remove_file(path).unwrap();

  let denied = QueryRowsRequest { database:"browse_other".into(), table:"confidential".into(), ..request.clone() };
  assert!(driver.query_rows(&denied).await.unwrap_err().contains("permission denied"));
  base.databases = Some(vec!["browse_other".into()]);
  base.database_credentials = Some(std::collections::HashMap::from([("browse_other".into(), DatabaseCredentialConfig { username:Some("browse_other_user".into()), password:Some("other-test-password".into()) })]));
  let alternate = EngineDriver::open(base.clone(), None).await.unwrap();
  assert_eq!(alternate.query_rows(&denied).await.unwrap().rows[0]["id"], 7);
  let user = alternate.execute_sql("SELECT current_user AS username, current_database() AS database", Some("browse_other")).await.unwrap();
  assert_eq!(user["rows"][0]["username"], "browse_other_user");
  assert_eq!(user["rows"][0]["database"], "browse_other");
  let mut bad_password = base.clone();
  bad_password.password = Some("incorrect-test-password".into());
  assert!(EngineDriver::test_connection(&bad_password, None).await.unwrap_err().contains("password authentication failed"));
  base.database = Some("database_that_does_not_exist".into());
  assert!(EngineDriver::test_connection(&base, None).await.is_err());
  driver.close().await;
  alternate.close().await;
  admin.close().await;
}
