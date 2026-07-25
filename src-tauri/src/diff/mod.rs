use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde_json::json;

use crate::drivers::EngineDriver;
use crate::types::{
  ColumnDiff, DatabaseDiff, IndexDiff, TableComparisonResult, TableDataDiff, TableDiff, TableSchema,
};

pub async fn diff_databases(
  source: Arc<EngineDriver>,
  source_db: &str,
  target: Arc<EngineDriver>,
  target_db: &str,
  compare_data: bool,
) -> Result<DatabaseDiff, String> {
  let source_tables = source.list_tables(source_db).await?;
  let target_tables = target.list_tables(target_db).await?;
  let source_set: HashSet<_> = source_tables.iter().cloned().collect();
  let target_set: HashSet<_> = target_tables.iter().cloned().collect();

  let mut source_only: Vec<_> = source_set.difference(&target_set).cloned().collect();
  let mut target_only: Vec<_> = target_set.difference(&source_set).cloned().collect();
  source_only.sort();
  target_only.sort();

  let mut shared: Vec<_> = source_set.intersection(&target_set).cloned().collect();
  shared.sort();

  let mut table_diffs = Vec::new();
  for table in shared {
    let comparison = diff_table(
      source.clone(),
      source_db,
      &table,
      target.clone(),
      target_db,
      &table,
      compare_data,
    )
    .await?;
    if let Some(td) = comparison.table_diff {
      table_diffs.push(td);
    }
  }

  Ok(DatabaseDiff {
    source_only_tables: source_only,
    target_only_tables: target_only,
    table_diffs,
  })
}

pub async fn diff_table(
  source: Arc<EngineDriver>,
  source_db: &str,
  source_table: &str,
  target: Arc<EngineDriver>,
  target_db: &str,
  target_table: &str,
  compare_data: bool,
) -> Result<TableComparisonResult, String> {
  let source_schema = source.get_table_schema(source_db, source_table).await?;
  let target_schema = target.get_table_schema(target_db, target_table).await?;
  let column_diffs = diff_columns(&source_schema, &target_schema);
  let index_diffs = diff_indexes(&source_schema, &target_schema);
  let mut status = if column_diffs.iter().any(|d| d.status != "identical")
    || index_diffs.iter().any(|d| d.status != "identical")
  {
    "different"
  } else {
    "identical"
  };

  let data_diff = if compare_data {
    Some(diff_data(source, source_db, source_table, target, target_db, target_table, &source_schema, &target_schema).await?)
  } else {
    None
  };

  if let Some(ref dd) = data_diff {
    if dd.modified > 0 || dd.source_only > 0 || dd.target_only > 0 {
      status = "different";
    }
  }

  let table_diff = if status == "identical" && data_diff.as_ref().map(|d| d.modified + d.source_only + d.target_only == 0).unwrap_or(true) {
    None
  } else {
    Some(TableDiff {
      table: source_table.to_string(),
      status: status.into(),
      column_diffs,
      index_diffs,
      data_diff,
    })
  };

  Ok(TableComparisonResult {
    table_diff,
    row_comparison: None,
  })
}

fn diff_columns(source: &TableSchema, target: &TableSchema) -> Vec<ColumnDiff> {
  let source_map: HashMap<_, _> = source.columns.iter().map(|c| (c.name.clone(), c)).collect();
  let target_map: HashMap<_, _> = target.columns.iter().map(|c| (c.name.clone(), c)).collect();
  let mut names: HashSet<_> = source_map.keys().cloned().collect();
  names.extend(target_map.keys().cloned());
  let mut names: Vec<_> = names.into_iter().collect();
  names.sort();
  names
    .into_iter()
    .map(|name| {
      let s = source_map.get(&name).cloned().cloned();
      let t = target_map.get(&name).cloned().cloned();
      let status = match (&s, &t) {
        (Some(a), Some(b))
          if a.col_type == b.col_type
            && a.nullable == b.nullable
            && a.default_value == b.default_value
            && a.is_primary_key == b.is_primary_key
            && a.is_auto_increment == b.is_auto_increment =>
        {
          "identical"
        }
        (Some(_), Some(_)) => "modified",
        (Some(_), None) => "sourceOnly",
        (None, Some(_)) => "targetOnly",
        _ => "identical",
      };
      ColumnDiff {
        name,
        status: status.into(),
        source: s,
        target: t,
      }
    })
    .collect()
}

fn diff_indexes(source: &TableSchema, target: &TableSchema) -> Vec<IndexDiff> {
  let source_map: HashMap<_, _> = source.indexes.iter().map(|i| (i.name.clone(), i)).collect();
  let target_map: HashMap<_, _> = target.indexes.iter().map(|i| (i.name.clone(), i)).collect();
  let mut names: HashSet<_> = source_map.keys().cloned().collect();
  names.extend(target_map.keys().cloned());
  let mut names: Vec<_> = names.into_iter().collect();
  names.sort();
  names
    .into_iter()
    .map(|name| {
      let s = source_map.get(&name).cloned().cloned();
      let t = target_map.get(&name).cloned().cloned();
      let status = match (&s, &t) {
        (Some(a), Some(b)) if a.unique == b.unique && a.columns == b.columns && a.index_type == b.index_type => {
          "identical"
        }
        (Some(_), Some(_)) => "modified",
        (Some(_), None) => "sourceOnly",
        (None, Some(_)) => "targetOnly",
        _ => "identical",
      };
      IndexDiff {
        name,
        status: status.into(),
        source: s,
        target: t,
      }
    })
    .collect()
}

async fn diff_data(
  source: Arc<EngineDriver>,
  source_db: &str,
  source_table: &str,
  target: Arc<EngineDriver>,
  target_db: &str,
  target_table: &str,
  source_schema: &TableSchema,
  target_schema: &TableSchema,
) -> Result<TableDataDiff, String> {
  let key = if !source_schema.primary_key.is_empty() && source_schema.primary_key == target_schema.primary_key {
    source_schema.primary_key.clone()
  } else if !source_schema.primary_key.is_empty() {
    source_schema.primary_key.clone()
  } else if !target_schema.primary_key.is_empty() {
    target_schema.primary_key.clone()
  } else {
    source_schema.columns.iter().map(|c| c.name.clone()).collect()
  };

  let source_rows = source
    .stream_rows_ordered(source_db, source_table, &key, 200)
    .await?;
  let target_rows = target
    .stream_rows_ordered(target_db, target_table, &key, 200)
    .await?;

  let mut identical = 0i64;
  let mut modified = 0i64;
  let mut source_only = 0i64;
  let mut target_only = 0i64;
  let mut samples = Vec::new();

  let mut i = 0usize;
  let mut j = 0usize;
  while i < source_rows.len() || j < target_rows.len() {
    if i >= source_rows.len() {
      target_only += 1;
      if samples.len() < 5 {
        samples.push(json!({"kind":"targetOnly","row": target_rows[j]}));
      }
      j += 1;
      continue;
    }
    if j >= target_rows.len() {
      source_only += 1;
      if samples.len() < 5 {
        samples.push(json!({"kind":"sourceOnly","row": source_rows[i]}));
      }
      i += 1;
      continue;
    }
    let sk = row_key(&source_rows[i], &key);
    let tk = row_key(&target_rows[j], &key);
    match sk.cmp(&tk) {
      std::cmp::Ordering::Equal => {
        if source_rows[i] == target_rows[j] {
          identical += 1;
        } else {
          modified += 1;
          if samples.len() < 5 {
            samples.push(json!({"kind":"modified","source": source_rows[i], "target": target_rows[j]}));
          }
        }
        i += 1;
        j += 1;
      }
      std::cmp::Ordering::Less => {
        source_only += 1;
        if samples.len() < 5 {
          samples.push(json!({"kind":"sourceOnly","row": source_rows[i]}));
        }
        i += 1;
      }
      std::cmp::Ordering::Greater => {
        target_only += 1;
        if samples.len() < 5 {
          samples.push(json!({"kind":"targetOnly","row": target_rows[j]}));
        }
        j += 1;
      }
    }
  }

  Ok(TableDataDiff {
    identical,
    modified,
    source_only,
    target_only,
    samples,
  })
}

fn row_key(row: &HashMap<String, serde_json::Value>, keys: &[String]) -> String {
  keys
    .iter()
    .map(|k| {
      row
        .get(k)
        .map(|v| v.to_string())
        .unwrap_or_else(|| "null".into())
    })
    .collect::<Vec<_>>()
    .join("\u{1}")
}
