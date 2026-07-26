mod fk_order;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde_json::Value;
use sqlx::Executor;
use tauri::{AppHandle, Emitter};

use crate::drivers::dialect::{
  quote_mysql_ident, quote_mysql_table, quote_pg_ident, quote_pg_table,
};
use crate::drivers::EngineDriver;
use crate::export_import::sql_literal;
use crate::sync::fk_order::order_tables_by_foreign_keys;
use crate::types::{SyncPlan, SyncProgressEvent, SyncRequest, SyncStep};

/// 预览计划里每张表最多渲染多少行 INSERT。
const PREVIEW_ROW_LIMIT: usize = 50;
/// 每条 INSERT 语句最多携带多少行（与 export_import 的分块保持一致）。
const INSERT_BATCH_SIZE: usize = 200;

/// UI 发送 'overwrite-structure'/'append-data'/'truncate-and-import'/'skip'；
/// 兼容旧值 'drop-and-recreate'，未知值一律回退为 skip。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExistingTableStrategy {
  Skip,
  DropAndRecreate,
  AppendData,
  TruncateAndImport,
}

fn normalize_strategy(raw: Option<&str>) -> ExistingTableStrategy {
  match raw.unwrap_or("skip") {
    "overwrite-structure" | "drop-and-recreate" => ExistingTableStrategy::DropAndRecreate,
    "append-data" => ExistingTableStrategy::AppendData,
    "truncate-and-import" => ExistingTableStrategy::TruncateAndImport,
    _ => ExistingTableStrategy::Skip,
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TargetDialect {
  Mysql,
  Postgres,
}

impl TargetDialect {
  fn of(target: &EngineDriver) -> Result<Self, String> {
    match target {
      EngineDriver::Mysql(_) => Ok(Self::Mysql),
      EngineDriver::Postgres(_) => Ok(Self::Postgres),
      EngineDriver::Redis(_) => Err("Sync target must be MySQL or PostgreSQL".into()),
    }
  }

  fn quote_table(&self, database: &str, table: &str) -> String {
    match self {
      Self::Mysql => quote_mysql_table(database, table),
      // PgDriver 连接到目标库本身，表操作固定走 public schema。
      Self::Postgres => quote_pg_table("public", table),
    }
  }

  fn quote_ident(&self, name: &str) -> String {
    match self {
      Self::Mysql => quote_mysql_ident(name),
      Self::Postgres => quote_pg_ident(name),
    }
  }
}

/// 单张表的同步动作（纯数据，便于测试）：先跑 setup_sqls，再视 insert_data 灌数据。
#[derive(Debug, Clone, PartialEq, Eq)]
struct TableActions {
  description_parts: Vec<String>,
  setup_sqls: Vec<String>,
  insert_data: bool,
  skip: bool,
}

fn join_description(parts: &[String]) -> String {
  if parts.is_empty() {
    "noop".into()
  } else {
    parts.join(", ")
  }
}

fn plan_table_actions(
  dialect: TargetDialect,
  target_database: &str,
  table: &str,
  exists_in_target: bool,
  sync_structure: bool,
  sync_data: bool,
  strategy: ExistingTableStrategy,
  create_sql: &str,
) -> TableActions {
  if exists_in_target && strategy == ExistingTableStrategy::Skip {
    return TableActions {
      description_parts: vec!["skip existing table".into()],
      setup_sqls: vec![],
      insert_data: false,
      skip: true,
    };
  }

  let target_table = dialect.quote_table(target_database, table);
  let mut setup_sqls = Vec::new();
  let mut description_parts: Vec<String> = Vec::new();

  if sync_structure {
    if exists_in_target {
      if strategy == ExistingTableStrategy::DropAndRecreate {
        setup_sqls.push(match dialect {
          TargetDialect::Mysql => format!("DROP TABLE IF EXISTS {target_table}"),
          TargetDialect::Postgres => format!("DROP TABLE IF EXISTS {target_table} CASCADE"),
        });
        if !create_sql.trim().is_empty() {
          setup_sqls.push(create_sql.trim().to_string());
        }
        description_parts.push("drop and recreate".into());
      } else {
        description_parts.push("keep target structure".into());
      }
    } else {
      if !create_sql.trim().is_empty() {
        setup_sqls.push(create_sql.trim().to_string());
      }
      description_parts.push("create table".into());
    }
  }

  if sync_data && exists_in_target && strategy == ExistingTableStrategy::TruncateAndImport {
    setup_sqls.push(format!("TRUNCATE TABLE {target_table}"));
    description_parts.push("truncate".into());
  }

  TableActions {
    description_parts,
    setup_sqls,
    insert_data: sync_data,
    skip: false,
  }
}

/// 用字面量渲染分块 INSERT（与 export_import 的 SQL 导出格式一致）。
fn build_insert_statements(
  target_table: &str,
  columns: &[String],
  rows: &[HashMap<String, Value>],
  dialect: TargetDialect,
  batch: usize,
) -> Vec<String> {
  if rows.is_empty() || columns.is_empty() {
    return vec![];
  }
  let col_sql = columns
    .iter()
    .map(|c| dialect.quote_ident(c))
    .collect::<Vec<_>>()
    .join(", ");
  rows
    .chunks(batch.max(1))
    .map(|chunk| {
      let values = chunk
        .iter()
        .map(|row| {
          let vals = columns
            .iter()
            .map(|c| sql_literal(row.get(c)))
            .collect::<Vec<_>>()
            .join(", ");
          format!("  ({vals})")
        })
        .collect::<Vec<_>>()
        .join(",\n");
      format!("INSERT INTO {target_table} ({col_sql}) VALUES\n{values}")
    })
    .collect()
}

pub async fn build_plan(
  source: Arc<EngineDriver>,
  target: Arc<EngineDriver>,
  req: &SyncRequest,
) -> Result<SyncPlan, String> {
  let dialect = TargetDialect::of(&target)?;
  let edges = source
    .list_foreign_key_edges(&req.source_database)
    .await
    .unwrap_or_default();
  let ordered = order_tables_by_foreign_keys(&req.tables, &edges);
  let sync_structure = req.sync_structure.unwrap_or(true);
  let sync_data = req.sync_data.unwrap_or(true);
  let strategy = normalize_strategy(req.existing_table_strategy.as_deref());

  let target_tables = target.list_tables(&req.target_database).await?;
  let target_set: HashSet<_> = target_tables.into_iter().collect();

  let mut steps = Vec::new();

  for table in ordered {
    let exists = target_set.contains(&table);
    if exists && strategy == ExistingTableStrategy::Skip {
      steps.push(SyncStep {
        table,
        description: "skip existing table".into(),
        sqls: vec![],
      });
      continue;
    }

    let schema = source
      .get_table_schema(&req.source_database, &table)
      .await?;
    let actions = plan_table_actions(
      dialect,
      &req.target_database,
      &table,
      exists,
      sync_structure,
      sync_data,
      strategy,
      &schema.create_sql,
    );
    let mut sqls = actions.setup_sqls.clone();
    let mut description_parts = actions.description_parts.clone();

    if sync_data {
      let rows = source
        .stream_rows_ordered(&req.source_database, &table, &schema.primary_key, 200)
        .await?;
      let columns: Vec<String> = schema.columns.iter().map(|c| c.name.clone()).collect();
      let preview = &rows[..rows.len().min(PREVIEW_ROW_LIMIT)];
      sqls.extend(build_insert_statements(
        &dialect.quote_table(&req.target_database, &table),
        &columns,
        preview,
        dialect,
        INSERT_BATCH_SIZE,
      ));
      if rows.len() > PREVIEW_ROW_LIMIT {
        sqls.push(format!("-- … {} more rows", rows.len() - PREVIEW_ROW_LIMIT));
      }
      description_parts.push(format!("insert {} rows", rows.len()));
    }

    steps.push(SyncStep {
      table: table.clone(),
      description: join_description(&description_parts),
      sqls,
    });
  }

  Ok(SyncPlan { steps })
}

/// 目标库写入连接：整个执行阶段固定一个会话，
/// 这样 MySQL 的 SET FOREIGN_KEY_CHECKS（会话级）才对后续 DDL/INSERT 生效。
enum TargetConn {
  Mysql(sqlx::pool::PoolConnection<sqlx::MySql>),
  Postgres(sqlx::pool::PoolConnection<sqlx::Postgres>),
}

impl TargetConn {
  async fn acquire(target: &EngineDriver, database: &str) -> Result<Self, String> {
    match target {
      EngineDriver::Mysql(d) => Ok(Self::Mysql(d.acquire(database).await?)),
      EngineDriver::Postgres(d) => Ok(Self::Postgres(d.acquire(database).await?)),
      EngineDriver::Redis(_) => Err("Sync target must be MySQL or PostgreSQL".into()),
    }
  }

  async fn execute(&mut self, sql: &str) -> Result<(), String> {
    match self {
      Self::Mysql(conn) => (&mut **conn)
        .execute(sql)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string()),
      Self::Postgres(conn) => (&mut **conn)
        .execute(sql)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string()),
    }
  }
}

pub async fn execute(
  app: &AppHandle,
  source: Arc<EngineDriver>,
  target: Arc<EngineDriver>,
  req: &SyncRequest,
) -> Result<(i64, i64), String> {
  if req.dry_run.unwrap_or(false) {
    let plan = build_plan(source, target, req).await?;
    return Ok((plan.steps.len() as i64, 0));
  }

  let dialect = TargetDialect::of(&target)?;
  let edges = source
    .list_foreign_key_edges(&req.source_database)
    .await
    .unwrap_or_default();
  let ordered = order_tables_by_foreign_keys(&req.tables, &edges);
  let sync_structure = req.sync_structure.unwrap_or(true);
  let sync_data = req.sync_data.unwrap_or(true);
  let strategy = normalize_strategy(req.existing_table_strategy.as_deref());

  let target_tables = target.list_tables(&req.target_database).await?;
  let target_set: HashSet<_> = target_tables.into_iter().collect();

  let mut tconn = TargetConn::acquire(&target, &req.target_database).await?;
  if dialect == TargetDialect::Mysql {
    let _ = tconn.execute("SET FOREIGN_KEY_CHECKS=0").await;
  }

  let mut executed = 0i64;
  let mut errors = 0i64;
  let total = ordered.len() as i64;

  for (idx, table) in ordered.iter().enumerate() {
    emit(
      app,
      table,
      "start",
      idx as i64,
      total,
      Some(format!("Syncing {table}")),
      "info",
    );
    let exists = target_set.contains(table);
    if exists && strategy == ExistingTableStrategy::Skip {
      executed += 1;
      emit(
        app,
        table,
        "done",
        (idx + 1) as i64,
        total,
        Some("skip existing table".into()),
        "info",
      );
      continue;
    }

    let result = async {
      let schema = source
        .get_table_schema(&req.source_database, table)
        .await?;
      let actions = plan_table_actions(
        dialect,
        &req.target_database,
        table,
        exists,
        sync_structure,
        sync_data,
        strategy,
        &schema.create_sql,
      );
      for sql in &actions.setup_sqls {
        tconn.execute(sql).await?;
      }
      if actions.insert_data {
        let rows = source
          .stream_rows_ordered(&req.source_database, table, &schema.primary_key, 200)
          .await?;
        let columns: Vec<String> = schema.columns.iter().map(|c| c.name.clone()).collect();
        let statements = build_insert_statements(
          &dialect.quote_table(&req.target_database, table),
          &columns,
          &rows,
          dialect,
          INSERT_BATCH_SIZE,
        );
        for (n, statement) in statements.iter().enumerate() {
          tconn.execute(statement).await?;
          emit(
            app,
            table,
            "progress",
            (((n + 1) * INSERT_BATCH_SIZE).min(rows.len())) as i64,
            rows.len() as i64,
            None,
            "info",
          );
        }
      }
      Ok::<(), String>(())
    }
    .await;

    match result {
      Ok(()) => {
        executed += 1;
        emit(app, table, "done", (idx + 1) as i64, total, None, "info");
      }
      Err(e) => {
        errors += 1;
        emit(
          app,
          table,
          "error",
          (idx + 1) as i64,
          total,
          Some(e),
          "error",
        );
      }
    }
  }

  if dialect == TargetDialect::Mysql {
    let _ = tconn.execute("SET FOREIGN_KEY_CHECKS=1").await;
  }

  Ok((executed, errors))
}

fn emit(
  app: &AppHandle,
  table: &str,
  step: &str,
  done: i64,
  total: i64,
  message: Option<String>,
  level: &str,
) {
  let _ = app.emit(
    "sync:progress",
    SyncProgressEvent {
      table: table.to_string(),
      step: step.to_string(),
      done,
      total,
      message,
      level: level.to_string(),
    },
  );
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn normalize_strategy_maps_ui_values_and_defaults_to_skip() {
    assert_eq!(
      normalize_strategy(Some("overwrite-structure")),
      ExistingTableStrategy::DropAndRecreate
    );
    assert_eq!(
      normalize_strategy(Some("drop-and-recreate")),
      ExistingTableStrategy::DropAndRecreate
    );
    assert_eq!(
      normalize_strategy(Some("append-data")),
      ExistingTableStrategy::AppendData
    );
    assert_eq!(
      normalize_strategy(Some("truncate-and-import")),
      ExistingTableStrategy::TruncateAndImport
    );
    assert_eq!(normalize_strategy(Some("skip")), ExistingTableStrategy::Skip);
    assert_eq!(normalize_strategy(Some("wat")), ExistingTableStrategy::Skip);
    assert_eq!(normalize_strategy(None), ExistingTableStrategy::Skip);
  }

  #[test]
  fn plan_creates_missing_table() {
    let actions = plan_table_actions(
      TargetDialect::Mysql,
      "db",
      "users",
      false,
      true,
      true,
      ExistingTableStrategy::Skip,
      "CREATE TABLE `users` (`id` bigint)",
    );
    assert!(!actions.skip);
    assert!(actions.insert_data);
    assert_eq!(actions.setup_sqls, vec!["CREATE TABLE `users` (`id` bigint)"]);
    assert_eq!(join_description(&actions.description_parts), "create table");
  }

  #[test]
  fn plan_overwrite_structure_drops_and_recreates() {
    let actions = plan_table_actions(
      TargetDialect::Mysql,
      "db",
      "users",
      true,
      true,
      true,
      normalize_strategy(Some("overwrite-structure")),
      "CREATE TABLE `users` (`id` bigint)",
    );
    assert_eq!(
      actions.setup_sqls,
      vec![
        "DROP TABLE IF EXISTS `db`.`users`",
        "CREATE TABLE `users` (`id` bigint)"
      ]
    );
    assert_eq!(join_description(&actions.description_parts), "drop and recreate");
    assert!(actions.insert_data);
  }

  #[test]
  fn plan_overwrite_structure_without_structure_sync_keeps_table() {
    let actions = plan_table_actions(
      TargetDialect::Mysql,
      "db",
      "users",
      true,
      false,
      true,
      ExistingTableStrategy::DropAndRecreate,
      "CREATE TABLE `users` (`id` bigint)",
    );
    assert!(actions.setup_sqls.is_empty());
    assert!(actions.insert_data);
  }

  #[test]
  fn plan_append_data_keeps_structure_and_inserts() {
    let actions = plan_table_actions(
      TargetDialect::Mysql,
      "db",
      "users",
      true,
      true,
      true,
      normalize_strategy(Some("append-data")),
      "CREATE TABLE `users` (`id` bigint)",
    );
    assert!(actions.setup_sqls.is_empty());
    assert_eq!(join_description(&actions.description_parts), "keep target structure");
    assert!(actions.insert_data);
    assert!(!actions.skip);
  }

  #[test]
  fn plan_truncate_and_import_truncates_existing_table() {
    let actions = plan_table_actions(
      TargetDialect::Mysql,
      "db",
      "users",
      true,
      true,
      true,
      ExistingTableStrategy::TruncateAndImport,
      "CREATE TABLE `users` (`id` bigint)",
    );
    assert_eq!(
      actions.setup_sqls,
      vec!["TRUNCATE TABLE `db`.`users`".to_string()]
    );
    assert_eq!(join_description(&actions.description_parts), "keep target structure, truncate");
  }

  #[test]
  fn plan_skip_strategy_skips_existing_table_entirely() {
    let actions = plan_table_actions(
      TargetDialect::Mysql,
      "db",
      "users",
      true,
      true,
      true,
      ExistingTableStrategy::Skip,
      "CREATE TABLE `users` (`id` bigint)",
    );
    assert!(actions.skip);
    assert!(actions.setup_sqls.is_empty());
    assert!(!actions.insert_data);
    assert_eq!(join_description(&actions.description_parts), "skip existing table");
  }

  #[test]
  fn plan_postgres_drop_uses_cascade_and_public_schema() {
    let actions = plan_table_actions(
      TargetDialect::Postgres,
      "db",
      "users",
      true,
      true,
      false,
      ExistingTableStrategy::DropAndRecreate,
      "CREATE TABLE users (id bigint)",
    );
    assert_eq!(
      actions.setup_sqls[0],
      "DROP TABLE IF EXISTS \"public\".\"users\" CASCADE"
    );
    assert!(!actions.insert_data);
  }

  #[test]
  fn insert_statements_chunk_rows_and_render_literals() {
    let columns = vec!["id".to_string(), "name".to_string()];
    let rows = vec![
      HashMap::from([("id".to_string(), json!(1)), ("name".to_string(), json!("a'b"))]),
      HashMap::from([("id".to_string(), json!(2)), ("name".to_string(), Value::Null)]),
      HashMap::from([("id".to_string(), json!(3)), ("name".to_string(), json!("c"))]),
    ];
    let statements =
      build_insert_statements("`db`.`users`", &columns, &rows, TargetDialect::Mysql, 2);
    assert_eq!(statements.len(), 2);
    assert_eq!(
      statements[0],
      "INSERT INTO `db`.`users` (`id`, `name`) VALUES\n  (1, 'a''b'),\n  (2, NULL)"
    );
    assert_eq!(
      statements[1],
      "INSERT INTO `db`.`users` (`id`, `name`) VALUES\n  (3, 'c')"
    );
  }

  #[test]
  fn insert_statements_empty_without_rows_or_columns() {
    let columns = vec!["id".to_string()];
    assert!(build_insert_statements("`t`", &columns, &[], TargetDialect::Mysql, 2).is_empty());
    let rows = vec![HashMap::from([("id".to_string(), json!(1))])];
    assert!(build_insert_statements("`t`", &[], &rows, TargetDialect::Mysql, 2).is_empty());
  }
}
