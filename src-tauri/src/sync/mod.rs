mod fk_order;

use std::sync::Arc;

use tauri::{AppHandle, Emitter};

use crate::drivers::EngineDriver;
use crate::sync::fk_order::order_tables_by_foreign_keys;
use crate::types::{SyncPlan, SyncPlanStep, SyncProgressEvent, SyncRequest};

pub async fn build_plan(
  source: Arc<EngineDriver>,
  target: Arc<EngineDriver>,
  req: &SyncRequest,
) -> Result<SyncPlan, String> {
  let edges = source
    .list_foreign_key_edges(&req.source_database)
    .await
    .unwrap_or_default();
  let ordered = order_tables_by_foreign_keys(&req.tables, &edges);
  let sync_structure = req.sync_structure.unwrap_or(true);
  let sync_data = req.sync_data.unwrap_or(true);
  let strategy = req
    .existing_table_strategy
    .as_deref()
    .unwrap_or("skip");

  let target_tables = target.list_tables(&req.target_database).await?;
  let target_set: std::collections::HashSet<_> = target_tables.into_iter().collect();

  let mut steps = Vec::new();
  let mut warnings = Vec::new();

  for table in ordered {
    let exists = target_set.contains(&table);
    if sync_structure {
      if !exists {
        let schema = source
          .get_table_schema(&req.source_database, &table)
          .await?;
        steps.push(SyncPlanStep {
          table: table.clone(),
          action: "create".into(),
          sql: Some(schema.create_sql.clone()),
          row_count: None,
        });
      } else if strategy == "drop-and-recreate" {
        steps.push(SyncPlanStep {
          table: table.clone(),
          action: "drop-and-create".into(),
          sql: None,
          row_count: None,
        });
      } else if strategy == "truncate-and-import" && sync_data {
        steps.push(SyncPlanStep {
          table: table.clone(),
          action: "truncate".into(),
          sql: None,
          row_count: None,
        });
      } else if strategy == "skip" {
        warnings.push(format!("Skipping existing table {table}"));
      }
    }
    if sync_data {
      let rows = source
        .stream_rows_ordered(&req.source_database, &table, &[], 200)
        .await?;
      let preview = rows.len().min(50) as i64;
      steps.push(SyncPlanStep {
        table: table.clone(),
        action: "insert".into(),
        sql: None,
        row_count: Some(if req.dry_run.unwrap_or(false) {
          preview
        } else {
          rows.len() as i64
        }),
      });
    }
  }

  Ok(SyncPlan { steps, warnings })
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

  let edges = source
    .list_foreign_key_edges(&req.source_database)
    .await
    .unwrap_or_default();
  let ordered = order_tables_by_foreign_keys(&req.tables, &edges);
  let sync_structure = req.sync_structure.unwrap_or(true);
  let sync_data = req.sync_data.unwrap_or(true);
  let strategy = req
    .existing_table_strategy
    .as_deref()
    .unwrap_or("skip");

  let _ = target
    .execute_sql("SET FOREIGN_KEY_CHECKS=0", Some(&req.target_database))
    .await;

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
    let target_tables = target.list_tables(&req.target_database).await.unwrap_or_default();
    let exists = target_tables.iter().any(|t| t == table);

    let result = async {
      if sync_structure {
        if !exists {
          let schema = source
            .get_table_schema(&req.source_database, table)
            .await?;
          if !schema.create_sql.trim().is_empty() {
            target
              .execute_sql(&schema.create_sql, Some(&req.target_database))
              .await?;
          }
        } else if strategy == "drop-and-recreate" {
          target
            .drop_table(&crate::types::DropTableRequest {
              connection_id: req.target_connection_id.clone(),
              database: req.target_database.clone(),
              table: table.clone(),
            })
            .await?;
          let schema = source
            .get_table_schema(&req.source_database, table)
            .await?;
          if !schema.create_sql.trim().is_empty() {
            target
              .execute_sql(&schema.create_sql, Some(&req.target_database))
              .await?;
          }
        } else if strategy == "truncate-and-import" {
          target
            .truncate_table(&crate::types::TruncateTableRequest {
              connection_id: req.target_connection_id.clone(),
              database: req.target_database.clone(),
              table: table.clone(),
              reset_identity: Some(true),
            })
            .await?;
        }
      }
      if sync_data {
        let schema = source
          .get_table_schema(&req.source_database, table)
          .await?;
        let rows = source
          .stream_rows_ordered(
            &req.source_database,
            table,
            &schema.primary_key,
            200,
          )
          .await?;
        for (n, row) in rows.iter().enumerate() {
          target
            .insert_row(&crate::types::InsertRowRequest {
              connection_id: req.target_connection_id.clone(),
              database: req.target_database.clone(),
              table: table.clone(),
              values: row.clone(),
            })
            .await?;
          if n % 20 == 0 {
            emit(
              app,
              table,
              "progress",
              n as i64,
              rows.len() as i64,
              None,
              "info",
            );
          }
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

  let _ = target
    .execute_sql("SET FOREIGN_KEY_CHECKS=1", Some(&req.target_database))
    .await;

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
