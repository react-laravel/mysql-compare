mod fk_order;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde_json::Value;
use sqlx::Executor;
use tauri::{AppHandle, Emitter};

use crate::drivers::dialect::{
  quote_mysql_ident, quote_mysql_table, quote_pg_ident, quote_pg_table,
};
use crate::drivers::dialect::{read_rows_sql, SqlDialect};
use crate::drivers::EngineDriver;
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
      // Scoped table keys carry their schema; legacy names use public.
      Self::Postgres => quote_pg_table("public", table),
    }
  }

  fn value(&self, value: Option<&Value>) -> String {
    match self {
      Self::Mysql => SqlDialect::Mysql,
      Self::Postgres => SqlDialect::Postgres,
    }
    .literal(value)
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
  existing_schemas: &HashSet<String>,
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
        if dialect == TargetDialect::Postgres {
          if let Some((schema, _)) = crate::drivers::dialect::scoped_pg_table(table) {
            // Even IF NOT EXISTS requires database CREATE permission in PostgreSQL.
            // Existing accessible schemas only need their own CREATE permission.
            if !existing_schemas.contains(&schema) {
              setup_sqls.push(format!("CREATE SCHEMA IF NOT EXISTS {}", quote_pg_ident(&schema)));
            }
          }
        }
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
            .map(|c| dialect.value(row.get(c)))
            .collect::<Vec<_>>()
            .join(", ");
          format!("  ({vals})")
        })
        .collect::<Vec<_>>()
        .join(",\n");
      format!(
        "INSERT INTO {target_table} ({col_sql}){} VALUES\n{values}",
        if dialect == TargetDialect::Postgres {
          " OVERRIDING SYSTEM VALUE"
        } else {
          ""
        }
      )
    })
    .collect()
}

struct PreviewRecord {
  created: std::time::Instant,
  request: String,
  schema: String,
}
static PREVIEWS: once_cell::sync::Lazy<parking_lot::Mutex<HashMap<String, PreviewRecord>>> =
  once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(HashMap::new()));

fn request_key(req: &SyncRequest) -> Result<String, String> {
  let mut request = req.clone();
  request.task_id = None;
  request.plan_id = None;
  request.dry_run = None;
  request.tables.sort();
  request.tables.dedup();
  serde_json::to_string(&request).map_err(|e| e.to_string())
}

async fn preflight(
  source: &EngineDriver,
  target: &EngineDriver,
  req: &SyncRequest,
) -> Result<String, String> {
  if req.tables.is_empty()
    || (!req.sync_structure.unwrap_or(true) && !req.sync_data.unwrap_or(true))
  {
    return Err("Select tables and at least one sync operation".into());
  }
  if source.same_database(target, &req.source_database, &req.target_database) {
    return Err("Source and target must be different databases".into());
  }
  let source_dialect = source.dialect()?;
  let target_dialect = target.dialect()?;
  if source_dialect != target_dialect && req.sync_structure.unwrap_or(true) {
    return Err("Cross-engine structure sync is not supported; select data only".into());
  }
  let target_tables = target.list_tables(&req.target_database).await?;
  let mut signatures = Vec::new();
  for table in &req.tables {
    crate::operations::check()?;
    let display_table = crate::drivers::dialect::pg_table_display_name(table);
    let source_schema = source.get_table_schema(&req.source_database, table).await?;
    let target_schema = if target_tables.contains(table) {
      Some(target.get_table_schema(&req.target_database, table).await?)
    } else {
      None
    };
    let skipped = target_schema.is_some()
      && normalize_strategy(req.existing_table_strategy.as_deref()) == ExistingTableStrategy::Skip;
    if !skipped {
      if target_schema.is_none() && !req.sync_structure.unwrap_or(true) {
        return Err(format!("Target table {display_table} does not exist"));
      }
      if req.sync_structure.unwrap_or(true)
        && (source_schema.create_sql.trim().is_empty()
          || source_schema.create_sql.contains("-- reconstructed"))
      {
        return Err(format!("Complete CREATE SQL is unavailable for {display_table}"));
      }
      if let Some(target_schema) = &target_schema {
        if req.sync_data.unwrap_or(true)
          && normalize_strategy(req.existing_table_strategy.as_deref())
            != ExistingTableStrategy::DropAndRecreate
        {
          for column in &source_schema.columns {
            if !target_schema
              .columns
              .iter()
              .any(|target| target.name == column.name)
            {
              return Err(format!("Target {display_table} is missing column {}", column.name));
            }
          }
        }
      }
      if req.sync_data.unwrap_or(true) {
        let sql = read_rows_sql(
          source_dialect,
          &req.source_database,
          table,
          &source_schema.primary_key,
          None,
          None,
          Some((0, 1)),
        )?;
        let mut rows = source.read_batches(&req.source_database, sql, 1).await?;
        if let Some(batch) = rows.recv().await {
          batch?;
        }
      }
    }
    signatures.push((
      table.clone(),
      source_schema.create_sql,
      target_schema.map(|schema| schema.create_sql),
    ));
  }
  signatures.sort_by(|a, b| a.0.cmp(&b.0));
  serde_json::to_string(&signatures).map_err(|e| e.to_string())
}

pub async fn build_plan(
  source: Arc<EngineDriver>,
  target: Arc<EngineDriver>,
  req: &SyncRequest,
) -> Result<SyncPlan, String> {
  let schema_signature = preflight(&source, &target, req).await?;
  let dialect = TargetDialect::of(&target)?;
  let edges = source.list_foreign_key_edges(&req.source_database).await?;
  let ordered = order_tables_by_foreign_keys(&req.tables, &edges);
  let sync_structure = req.sync_structure.unwrap_or(true);
  let sync_data = req.sync_data.unwrap_or(true);
  let strategy = normalize_strategy(req.existing_table_strategy.as_deref());

  let target_tables = target.list_tables(&req.target_database).await?;
  let target_set: HashSet<_> = target_tables.into_iter().collect();
  let existing_schemas = if dialect == TargetDialect::Postgres && sync_structure {
    target.list_schemas(&req.target_database).await?.into_iter().collect()
  } else { HashSet::new() };

  let mut steps = Vec::new();

  for table in ordered {
    crate::operations::check()?;
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
      &existing_schemas,
    );
    let mut sqls = actions.setup_sqls.clone();
    let mut description_parts = actions.description_parts.clone();

    if sync_data {
      let sql = read_rows_sql(
        source.dialect()?,
        &req.source_database,
        &table,
        &schema.primary_key,
        None,
        None,
        Some((0, PREVIEW_ROW_LIMIT as u32)),
      )?;
      let mut batches = source
        .read_batches(&req.source_database, sql, PREVIEW_ROW_LIMIT)
        .await?;
      let mut rows = Vec::new();
      while let Some(batch) = batches.recv().await {
    crate::operations::check()?;
        rows.extend(batch?);
      }
      let columns: Vec<String> = schema
        .columns
        .iter()
        .filter(|c| !c.is_generated)
        .map(|c| c.name.clone())
        .collect();
      let preview = &rows[..rows.len().min(PREVIEW_ROW_LIMIT)];
      sqls.extend(build_insert_statements(
        &dialect.quote_table(&req.target_database, &table),
        &columns,
        preview,
        dialect,
        INSERT_BATCH_SIZE,
      ));
      if rows.len() == PREVIEW_ROW_LIMIT {
        sqls.push("-- Preview limited to 50 rows; execution streams all rows".into());
      }
      description_parts.push(format!("data preview: {} rows", rows.len()));
    }

    steps.push(SyncStep {
      table: table.clone(),
      description: join_description(&description_parts),
      sqls,
    });
  }

  let id = uuid::Uuid::new_v4().to_string();
  let mut previews = PREVIEWS.lock();
  previews.retain(|_, value| value.created.elapsed() < std::time::Duration::from_secs(900));
  if previews.len() >= 64 {
    previews.clear();
  }
  previews.insert(
    id.clone(),
    PreviewRecord {
      created: std::time::Instant::now(),
      request: request_key(req)?,
      schema: schema_signature,
    },
  );
  Ok(SyncPlan {
    plan_id: Some(id),
    steps,
  })
}

/// 目标库写入连接：整个执行阶段固定一个会话，
/// 这样 MySQL 的 SET FOREIGN_KEY_CHECKS（会话级）才对后续 DDL/INSERT 生效。
enum TargetConn {
  Mysql(crate::drivers::connection_options::ActiveConnection<sqlx::MySql>),
  Postgres(crate::drivers::connection_options::ActiveConnection<sqlx::Postgres>),
}

impl TargetConn {
  async fn acquire(target: &EngineDriver, database: &str) -> Result<Self, String> {
    match target {
      EngineDriver::Mysql(d) => {
        Ok(Self::Mysql(d.acquire_active(database).await?))
      }
      EngineDriver::Postgres(d) => Ok(Self::Postgres(d.acquire_active(database).await?)),
      EngineDriver::Redis(_) => Err("Sync target must be MySQL or PostgreSQL".into()),
    }
  }

  fn complete(self) { match self { Self::Mysql(connection) => connection.complete(), Self::Postgres(connection) => connection.complete() } }

  async fn execute(&mut self, sql: &str) -> Result<(), String> {
    crate::operations::check()?;
    let operation = async {
      match self {
        Self::Mysql(conn) => (&mut **conn).execute(sql).await.map(|_| ()).map_err(|e| e.to_string()),
        Self::Postgres(conn) => (&mut **conn).execute(sql).await.map(|_| ()).map_err(|e| e.to_string()),
      }
    };
    tokio::time::timeout(std::time::Duration::from_secs(60), operation).await.map_err(|_| "Sync statement exceeded the 60 second limit; earlier committed changes are retained".to_string())?
  }

}

pub async fn execute(
  app: &AppHandle,
  source: Arc<EngineDriver>,
  target: Arc<EngineDriver>,
  req: &SyncRequest,
) -> Result<(i64, i64), String> {
  execute_with_progress(
    &|event| {
      let _ = app.emit("sync:progress", event);
    },
    source,
    target,
    req,
  )
  .await
}

pub async fn execute_with_progress(
  progress: &(dyn Fn(SyncProgressEvent) + Sync),
  source: Arc<EngineDriver>,
  target: Arc<EngineDriver>,
  req: &SyncRequest,
) -> Result<(i64, i64), String> {
  if req.dry_run.unwrap_or(false) {
    let plan = build_plan(source, target, req).await?;
    return Ok((plan.steps.len() as i64, 0));
  }

  let signature = preflight(&source, &target, req).await?;
  if let Some(id) = &req.plan_id {
    let preview = PREVIEWS
      .lock()
      .remove(id)
      .ok_or("Sync preview has expired; build it again")?;
    if preview.created.elapsed() >= std::time::Duration::from_secs(900)
      || preview.request != request_key(req)?
      || preview.schema != signature
    {
      return Err("Sync configuration or schema changed; build the preview again".into());
    }
  }
  let dialect = TargetDialect::of(&target)?;
  let edges = source.list_foreign_key_edges(&req.source_database).await?;
  let ordered = order_tables_by_foreign_keys(&req.tables, &edges);
  let sync_structure = req.sync_structure.unwrap_or(true);
  let sync_data = req.sync_data.unwrap_or(true);
  let strategy = normalize_strategy(req.existing_table_strategy.as_deref());

  let target_tables = target.list_tables(&req.target_database).await?;
  let target_set: HashSet<_> = target_tables.into_iter().collect();
  let existing_schemas = if dialect == TargetDialect::Postgres && sync_structure {
    target.list_schemas(&req.target_database).await?.into_iter().collect()
  } else { HashSet::new() };

  let mut tconn = TargetConn::acquire(&target, &req.target_database).await?;
  if dialect == TargetDialect::Mysql {
    tconn.execute("SET FOREIGN_KEY_CHECKS=0").await?;
  }

  let mut executed = 0i64;
  let mut errors = 0i64;
  let total = ordered.len() as i64;

  for (idx, table) in ordered.iter().enumerate() {
    crate::operations::check()?;
    emit(
      progress,
      req.task_id.as_deref(),
      table,
      "start",
      idx as i64,
      total,
      Some(format!("Syncing {}", crate::drivers::dialect::pg_table_display_name(table))),
      "info",
    );
    let exists = target_set.contains(table);
    if exists && strategy == ExistingTableStrategy::Skip {
      executed += 1;
      emit(
        progress,
        req.task_id.as_deref(),
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
      let schema = source.get_table_schema(&req.source_database, table).await?;
      let actions = plan_table_actions(
        dialect,
        &req.target_database,
        table,
        exists,
        sync_structure,
        sync_data,
        strategy,
        &schema.create_sql,
        &existing_schemas,
      );
      for sql in &actions.setup_sqls {
    crate::operations::check()?;
        tconn.execute(sql).await?;
      }
      if actions.insert_data {
        let sql = read_rows_sql(
          source.dialect()?,
          &req.source_database,
          table,
          &schema.primary_key,
          None,
          None,
          None,
        )?;
        let mut batches = source
          .read_batches(&req.source_database, sql, INSERT_BATCH_SIZE)
          .await?;
        let columns: Vec<String> = schema
          .columns
          .iter()
          .filter(|c| !c.is_generated)
          .map(|c| c.name.clone())
          .collect();
        let mut copied = 0;
        while let Some(rows) = batches.recv().await {
    crate::operations::check()?;
          let rows = rows?;
          for statement in build_insert_statements(
            &dialect.quote_table(&req.target_database, table),
            &columns,
            &rows,
            dialect,
            INSERT_BATCH_SIZE,
          ) {
            tconn.execute(&statement).await?;
          }
          copied += rows.len() as i64;
          emit(
            progress,
            req.task_id.as_deref(),
            table,
            "progress",
            copied,
            0,
            Some(format!("Copied {copied} rows")),
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
        emit(
          progress,
          req.task_id.as_deref(),
          table,
          "done",
          (idx + 1) as i64,
          total,
          None,
          "info",
        );
      }
      Err(e) => {
        errors += 1;
        emit(
          progress,
          req.task_id.as_deref(),
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
    tconn.execute("SET FOREIGN_KEY_CHECKS=1").await?;
  }

  tconn.complete();
  Ok((executed, errors))
}

fn emit(
  progress: &(dyn Fn(SyncProgressEvent) + Sync),
  task_id: Option<&str>,
  table: &str,
  step: &str,
  done: i64,
  total: i64,
  message: Option<String>,
  level: &str,
) {
  progress(SyncProgressEvent {
    task_id: task_id.map(str::to_string),
    table: table.to_string(),
    step: step.to_string(),
    done,
    total,
    message,
    level: level.to_string(),
  });
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
    assert_eq!(
      normalize_strategy(Some("skip")),
      ExistingTableStrategy::Skip
    );
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
      &HashSet::new(),
    );
    assert!(!actions.skip);
    assert!(actions.insert_data);
    assert_eq!(
      actions.setup_sqls,
      vec!["CREATE TABLE `users` (`id` bigint)"]
    );
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
      &HashSet::new(),
    );
    assert_eq!(
      actions.setup_sqls,
      vec![
        "DROP TABLE IF EXISTS `db`.`users`",
        "CREATE TABLE `users` (`id` bigint)"
      ]
    );
    assert_eq!(
      join_description(&actions.description_parts),
      "drop and recreate"
    );
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
      &HashSet::new(),
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
      &HashSet::new(),
    );
    assert!(actions.setup_sqls.is_empty());
    assert_eq!(
      join_description(&actions.description_parts),
      "keep target structure"
    );
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
      &HashSet::new(),
    );
    assert_eq!(
      actions.setup_sqls,
      vec!["TRUNCATE TABLE `db`.`users`".to_string()]
    );
    assert_eq!(
      join_description(&actions.description_parts),
      "keep target structure, truncate"
    );
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
      &HashSet::new(),
    );
    assert!(actions.skip);
    assert!(actions.setup_sqls.is_empty());
    assert!(!actions.insert_data);
    assert_eq!(
      join_description(&actions.description_parts),
      "skip existing table"
    );
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
      &HashSet::new(),
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
      HashMap::from([
        ("id".to_string(), json!(1)),
        ("name".to_string(), json!("a'b")),
      ]),
      HashMap::from([
        ("id".to_string(), json!(2)),
        ("name".to_string(), Value::Null),
      ]),
      HashMap::from([
        ("id".to_string(), json!(3)),
        ("name".to_string(), json!("c")),
      ]),
    ];
    let statements =
      build_insert_statements("`db`.`users`", &columns, &rows, TargetDialect::Mysql, 2);
    assert_eq!(statements.len(), 2);
    assert_eq!(
      statements[0],
      "INSERT INTO `db`.`users` (`id`, `name`) VALUES\n  (1, CONVERT(X'612762' USING utf8mb4)),\n  (2, NULL)"
    );
    assert_eq!(
      statements[1],
      "INSERT INTO `db`.`users` (`id`, `name`) VALUES\n  (3, CONVERT(X'63' USING utf8mb4))"
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
