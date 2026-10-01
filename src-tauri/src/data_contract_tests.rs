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
  assert_eq!(first.total, 3);
  assert!(first.has_more);
  assert!(!first.total_is_exact);
  let last = driver.query_rows(&QueryRowsRequest { page: 2, ..req.clone() }).await.unwrap();
  assert_eq!(last.total, 4);
  assert!(!last.has_more);
  assert!(last.total_is_exact);
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
          page_size: 500,
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
  let row_count = driver.execute_sql("SELECT COUNT(*) AS count FROM items", Some("contracts_target")).await.unwrap();
  assert_eq!(row_count["rows"][0]["count"].as_i64().or_else(|| row_count["rows"][0]["count"].as_str().and_then(|n| n.parse().ok())), Some(100004));
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

async fn browsing_and_import_security(engine: &str, port_var: &str) {
  let port: u16 = std::env::var(port_var).unwrap().parse().unwrap();
  let config: ConnectionConfig = serde_json::from_value(json!({"id":"security", "engine":engine, "name":"security disposable", "host":"127.0.0.1", "port":port, "username":if engine == "mysql" { "root" } else { "contract_test" }, "database":"contracts", "createdAt":0,"updatedAt":0})).unwrap();
  let driver = EngineDriver::open(config.clone(), None).await.unwrap();
  driver.execute_sql("CREATE TABLE security_import (id INTEGER PRIMARY KEY, label TEXT)", Some("contracts")).await.unwrap();
  let failed = driver.import_sql("contracts", &["INSERT INTO security_import VALUES (1, 'first')".into(), "INSERT INTO security_import VALUES (1, 'duplicate')".into()]).await;
  assert!(failed.is_err());
  let req: QueryRowsRequest = serde_json::from_value(json!({"connectionId":"security", "database":"contracts", "table":"security_import", "page":1,"pageSize":2})).unwrap();
  assert!(driver.query_rows(&req).await.unwrap().rows.is_empty(), "DML import rolls back every prior statement");
  assert_eq!(driver.import_sql("contracts", &["INSERT INTO security_import VALUES (1, 'first')".into(), "INSERT INTO security_import VALUES (2, 'second')".into(), "INSERT INTO security_import VALUES (3, 'third')".into()]).await.unwrap(), 3);
  let page = driver.query_rows(&req).await.unwrap();
  assert_eq!(page.rows.len(), 2); assert!(page.has_more); assert!(!page.total_is_exact);
  let last = driver.query_rows(&QueryRowsRequest { page:2, ..req.clone() }).await.unwrap();
  assert_eq!(last.total, 3); assert!(last.total_is_exact); assert!(!last.has_more);
  assert!(driver.query_rows(&QueryRowsRequest { order_by:Some(OrderBy { column:"id".into(), dir:"ASC; DROP TABLE security_import".into() }), ..req.clone() }).await.is_err());
  assert_eq!(driver.query_rows(&req).await.unwrap().rows.len(), 2);
  if engine == "mysql" {
    let literal = driver.execute_sql("SELECT 'OPTIMIZE TABLE' AS label", Some("contracts")).await.unwrap();
    assert_eq!(literal["rows"][0]["label"], "OPTIMIZE TABLE");
    assert!(driver.execute_sql("OPTIMIZE TABLE security_import", Some("contracts")).await.unwrap_err().contains("safe cancellation"));
    assert!(driver.import_sql("contracts", &["INSERT INTO security_import VALUES (4,'must not execute')".into(), "/*!80000 REPAIR TABLE security_import */".into()]).await.unwrap_err().contains("safe cancellation"));
    let key = serde_json::from_value(json!({"id":4})).unwrap();
    assert!(driver.query_rows(&QueryRowsRequest { key_rows:Some(vec![key]), ..req.clone() }).await.unwrap().rows.is_empty(), "Reject the entire maintenance import before any statement executes");
  }
  let mode_driver = EngineDriver::open(config.clone(), None).await.unwrap();
  let mode_sql = if engine == "mysql" { "SET SESSION sql_mode='NO_BACKSLASH_ESCAPES'" } else { "SET standard_conforming_strings = off" };
  {
    use sqlx::Executor;
    match &mode_driver {
      EngineDriver::Mysql(driver) => {
        let mut connection = driver.acquire_active("contracts").await.unwrap();
        (&mut *connection).execute(mode_sql).await.unwrap();
        connection.complete_and_wait().await;
      }
      EngineDriver::Postgres(driver) => {
        let mut connection = driver.acquire_active("contracts").await.unwrap();
        (&mut *connection).execute(mode_sql).await.unwrap();
        connection.complete_and_wait().await;
      }
      _ => unreachable!(),
    }
  }
  assert!(mode_driver.import_sql("contracts", &["SELECT 1".into()]).await.is_err(), "Reject parsing under a nonstandard existing session mode");
  mode_driver.close().await;
  assert!(driver.import_sql("contracts", &[mode_sql.into(), "INSERT INTO security_import VALUES (4,'must roll back')".into()]).await.is_err(), "Recheck the session mode after a script changes it");
  let missing_key = serde_json::from_value(json!({"id":4})).unwrap();
  assert!(driver.query_rows(&QueryRowsRequest { key_rows:Some(vec![missing_key]), ..req.clone() }).await.unwrap().rows.is_empty());
  let operations = crate::operations::Operations::default();
  let slow = if engine == "mysql" { "SELECT SLEEP(5)" } else { "SELECT pg_sleep(5)" };
  let query = operations.run(Some("security-cancel"), driver.execute_sql(slow, Some("contracts")));
  let cancel = async { tokio::time::sleep(std::time::Duration::from_millis(50)).await; operations.cancel("security-cancel").unwrap(); };
  let (canceled, _) = tokio::join!(tokio::time::timeout(std::time::Duration::from_secs(2), query), cancel);
  assert!(canceled.unwrap().unwrap_err().contains("canceled"));
  let after_cancel = driver.execute_sql("SELECT 'ready' AS state", Some("contracts")).await.unwrap();
  assert_eq!(after_cancel["rows"][0]["state"], "ready", "A canceled socket must not contaminate later pooled queries");
  let active_sql = if engine == "mysql" { "SELECT COUNT(*) AS active FROM information_schema.PROCESSLIST WHERE INFO = 'SELECT SLEEP(5)'" } else { "SELECT COUNT(*)::bigint AS active FROM pg_stat_activity WHERE query = 'SELECT pg_sleep(5)' AND state = 'active'" };
  let mut stopped = false;
  for _ in 0..20 {
    let active = driver.execute_sql(active_sql, Some("contracts")).await.unwrap();
    let count = active["rows"][0]["active"].as_i64().or_else(|| active["rows"][0]["active"].as_str().and_then(|n| n.parse().ok())).unwrap();
    if count == 0 { stopped = true; break; }
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
  }
  assert!(stopped, "Cancellation must stop the server statement, not only release the local future");
  let large_text = if engine == "mysql" { "MEDIUMTEXT" } else { "TEXT" };
  let blob_type = if engine == "mysql" { "BLOB" } else { "BYTEA" };
  let json_type = if engine == "mysql" { "JSON" } else { "JSONB" };
  let binary = if engine == "mysql" { "X'00ff'" } else { "decode('00ff','hex')" };
  driver.execute_sql(&format!("CREATE TABLE security_cursor (tenant INTEGER, seq INTEGER, visible TEXT, payload {large_text}, binary_data {blob_type}, private_json {json_type}, PRIMARY KEY(tenant, seq)); INSERT INTO security_cursor VALUES (1,1,'first',REPEAT('x',262144),{binary}, '{{\"secret\":true}}'),(1,4,'second',REPEAT('x',262144),{binary}, '{{\"secret\":true}}'),(2,1,'third',REPEAT('x',262144),{binary}, '{{\"secret\":true}}'),(2,6,'fourth',REPEAT('x',262144),{binary}, '{{\"secret\":true}}'),(7,2,'last',REPEAT('x',262144),{binary}, '{{\"secret\":true}}')"), Some("contracts")).await.unwrap();
  let cursor_req = QueryRowsRequest { table:"security_cursor".into(), columns:Some(vec!["visible".into()]), ..req.clone() };
  let first = driver.query_rows(&cursor_req).await.unwrap();
  assert_eq!(first.rows.len(), 2);
  assert_eq!(first.rows[1]["seq"], 4);
  assert_eq!(first.rows[0].len(), 3, "Only visible and mandatory PK fields cross IPC; hidden TEXT/BLOB/JSON remain on the server");
  assert_eq!(first.columns.len(), 6, "Schema metadata remains complete for the column picker");
  let second = driver.query_rows(&QueryRowsRequest { page:2, after:first.next_cursor.clone(), ..cursor_req.clone() }).await.unwrap();
  assert_eq!(second.rows[0]["tenant"], 2); assert_eq!(second.rows[1]["seq"], 6);
  let last = driver.query_rows(&QueryRowsRequest { page:3, after:second.next_cursor, ..cursor_req.clone() }).await.unwrap();
  assert_eq!(last.rows[0]["tenant"], 7); assert!(!last.has_more); assert!(!last.total_is_exact);
  let arbitrary = driver.query_rows(&QueryRowsRequest { page:99, page_size:50, after:Some(serde_json::from_value(json!({"tenant":0,"seq":0})).unwrap()), ..cursor_req.clone() }).await.unwrap();
  assert_eq!(arbitrary.rows.len(), 5); assert_eq!(arbitrary.total, 5); assert!(!arbitrary.total_is_exact, "An arbitrary cursor cannot prove the count of preceding rows");
  let only_keys = driver.query_rows(&QueryRowsRequest { columns:Some(vec![]), ..cursor_req.clone() }).await.unwrap();
  assert_eq!(only_keys.rows[0].len(), 2);
  for invalid in [json!({"tenant":1}), json!({"tenant":1,"seq":null}), json!({"tenant":1,"seq":4,"extra":0})] {
    assert!(driver.query_rows(&QueryRowsRequest { after:Some(serde_json::from_value(invalid).unwrap()), ..cursor_req.clone() }).await.is_err());
  }
  assert!(driver.query_rows(&QueryRowsRequest { columns:Some(vec!["unknown".into()]), ..cursor_req.clone() }).await.is_err());
  assert!(driver.query_rows(&QueryRowsRequest { after:first.next_cursor.clone(), order_by:Some(OrderBy{column:"seq".into(),dir:"ASC".into()}), ..cursor_req.clone() }).await.is_err());
  let filtered = driver.query_rows(&QueryRowsRequest { after:Some(serde_json::from_value(json!({"tenant":2,"seq":6})).unwrap()), where_sql:Some("tenant=2 OR tenant=7".into()), ..cursor_req.clone() }).await.unwrap();
  assert_eq!(filtered.rows.len(), 1); assert_eq!(filtered.rows[0]["tenant"], 7);
  let mut verified = config; verified.tls_mode = Some(TlsMode::VerifyFull);
  // The disposable runner's CA is not trusted by the operating system.
  assert!(EngineDriver::test_connection(&verified, None).await.is_err());
  if let Ok(path) = std::env::var("MYSQL_COMPARE_TEST_CA_PEM") {
    verified.tls_ca_pem = Some(std::fs::read_to_string(path).unwrap());
    assert!(EngineDriver::test_connection(&verified, None).await.is_ok(), "Private CA and correct IP identity must verify");
    // The certificate contains only an IP SAN; localhost reaches the same socket
    // but must not pass hostname verification.
    verified.host = "localhost".into();
    assert!(EngineDriver::test_connection(&verified, None).await.is_err(), "Wrong host identity must fail");
  } else {
    eprintln!("SKIPPED {engine} TLS fixture checks: MYSQL_COMPARE_TEST_CA_PEM is absent; run scripts/test-data-contracts.py for CA and hostname verification");
  }
  driver.close().await;
}

#[tokio::test]
#[ignore = "requires disposable MySQL; run scripts/test-data-contracts.py"]
async fn mysql_browsing_import_security() { browsing_and_import_security("mysql", "MYSQL_COMPARE_MYSQL_TEST_PORT").await; }

#[tokio::test]
#[ignore = "requires disposable PostgreSQL; run scripts/test-data-contracts.py"]
async fn postgres_browsing_import_security() { browsing_and_import_security("postgres", "MYSQL_COMPARE_PG_TEST_PORT").await; }

#[tokio::test]
#[ignore = "requires disposable TLS RESP probe; run scripts/test-data-contracts.py"]
async fn redis_tls_certificate_security() {
  let Ok(port) = std::env::var("MYSQL_COMPARE_REDIS_TLS_TEST_PORT") else {
    eprintln!("SKIPPED Redis TLS fixture checks: MYSQL_COMPARE_REDIS_TLS_TEST_PORT is absent; run scripts/test-data-contracts.py for CA and hostname verification");
    return;
  };
  let port: u16 = port.parse().unwrap();
  let mut config: ConnectionConfig = serde_json::from_value(json!({"id":"redis-tls", "engine":"redis", "name":"TLS probe", "host":"127.0.0.1", "port":port, "username":"", "database":"0", "tlsMode":"verify-full", "createdAt":0,"updatedAt":0})).unwrap();
  assert!(EngineDriver::test_connection(&config, None).await.is_err(), "Untrusted certificate must fail");
  config.tls_ca_pem = Some(std::fs::read_to_string(std::env::var("MYSQL_COMPARE_TEST_CA_PEM").unwrap()).unwrap());
  assert!(EngineDriver::test_connection(&config, None).await.is_ok(), "Private CA and matching IP identity must verify");
  config.host = "localhost".into();
  assert!(EngineDriver::test_connection(&config, None).await.is_err(), "Hostname mismatch must fail");
}

#[tokio::test]
#[ignore = "requires disposable Redis; run scripts/test-data-contracts.py"]
async fn redis_scan_cursor_and_remote_pattern_contract() {
  let port: u16 = std::env::var("MYSQL_COMPARE_REDIS_TEST_PORT").unwrap().parse().unwrap();
  let config: ConnectionConfig = serde_json::from_value(json!({"id":"redis-scan", "engine":"redis", "name":"disposable", "host":"127.0.0.1", "port":port, "username":"", "database":"0", "createdAt":0,"updatedAt":0})).unwrap();
  let driver = EngineDriver::open(config, None).await.unwrap();
  let mut connection = redis::Client::open(format!("redis://127.0.0.1:{port}/0")).unwrap().get_multiplexed_async_connection().await.unwrap();
  let mut pipeline = redis::pipe();
  for index in 0..13050 { pipeline.cmd("SET").arg(format!("bulk:{index}")).arg("fixture").ignore(); }
  pipeline.query_async::<()>(&mut connection).await.unwrap();
  let initial = driver.scan_redis_keys("0", "0", None).await.unwrap();
  assert!(!initial.complete); assert_ne!(initial.next_cursor, "0");
  let legacy: std::collections::HashSet<_> = driver.list_tables("0").await.unwrap().into_iter().collect();
  assert_eq!(legacy.len(), 10000);
  let target = (0..13050).map(|index| format!("bulk:{index}")).find(|key| !legacy.contains(key)).unwrap();
  let mut cursor = "0".to_string();
  let mut found = Vec::new();
  let mut empty_nonfinal = false;
  for _ in 0..100 {
    let batch = driver.scan_redis_keys("0", &cursor, Some(&target)).await.unwrap();
    if batch.keys.is_empty() && !batch.complete { empty_nonfinal = true; }
    found.extend(batch.keys);
    cursor = batch.next_cursor;
    if batch.complete { break; }
  }
  assert_eq!(cursor, "0"); assert!(empty_nonfinal, "A filtered empty batch does not imply completion");
  assert_eq!(found, vec![target], "MATCH discovers a key outside the original 10,000-key cap");
  let mut all = std::collections::HashSet::new();
  cursor = "0".into();
  for _ in 0..100 {
    let batch = driver.scan_redis_keys("0", &cursor, None).await.unwrap();
    all.extend(batch.keys);
    cursor = batch.next_cursor;
    if batch.complete { break; }
  }
  assert_eq!(cursor, "0"); assert_eq!(all.len(), 13050);
  assert!(driver.scan_redis_keys("0", "-1", None).await.is_err());
  assert!(driver.scan_redis_keys("0", "18446744073709551616", None).await.is_err());
  assert!(driver.scan_redis_keys("0", "0", Some(&"x".repeat(4097))).await.is_err());
  driver.close().await;
}
