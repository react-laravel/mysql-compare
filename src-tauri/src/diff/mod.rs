// 数据库结构 / 数据对比：表 / 列 / 索引定义 + 主键配对的行级 data diff。
// 输出契约与 src/shared/types.ts 对齐；行为参照 electron 分支的 diff-service。
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;

use serde_json::Value;

use crate::drivers::EngineDriver;
use crate::types::{
  ColumnDiff, ColumnInfo, DatabaseDiff, DiffKind, IndexDiff, IndexInfo, TableComparisonResult,
  TableDataDiff, TableDataDiffSample, TableDiff, TableRowComparison, TableSchema,
};

const DATA_DIFF_BATCH_SIZE: usize = 200;
const DATA_DIFF_SAMPLE_LIMIT: usize = 5;
const SAMPLE_PREVIEW_MAX_CHARS: usize = 80;

pub async fn diff_databases(
  source: Arc<EngineDriver>,
  source_db: &str,
  target: Arc<EngineDriver>,
  target_db: &str,
  include_data: bool,
  tables: Option<&[String]>,
) -> Result<DatabaseDiff, String> {
  let source_tables = source.list_tables(source_db).await?;
  let target_tables = target.list_tables(target_db).await?;
  let source_set: HashSet<&str> = source_tables.iter().map(String::as_str).collect();
  let target_set: HashSet<&str> = target_tables.iter().map(String::as_str).collect();

  let all = collect_diff_tables(&source_tables, &target_tables, tables);

  let mut table_diffs = Vec::new();
  let mut row_comparisons = Vec::new();
  for table in all {
    let in_source = source_set.contains(table.as_str());
    let in_target = target_set.contains(table.as_str());
    match (in_source, in_target) {
      (true, false) => table_diffs.push(only_table_diff(&table, DiffKind::OnlyInSource)),
      (false, true) => table_diffs.push(only_table_diff(&table, DiffKind::OnlyInTarget)),
      (false, false) => {}
      (true, true) => {
        let comparison = compare_shared_table(
          source.clone(),
          source_db,
          target.clone(),
          target_db,
          &table,
          include_data,
        )
        .await?;
        if let Some(td) = comparison.table_diff {
          table_diffs.push(td);
        }
        if let Some(rc) = comparison.row_comparison {
          row_comparisons.push(rc);
        }
      }
    }
  }

  Ok(DatabaseDiff {
    source_database: source_db.to_string(),
    target_database: target_db.to_string(),
    table_diffs,
    row_comparisons,
  })
}

pub async fn diff_table(
  source: Arc<EngineDriver>,
  source_db: &str,
  target: Arc<EngineDriver>,
  target_db: &str,
  table: &str,
  include_data: bool,
) -> Result<TableComparisonResult, String> {
  compare_shared_table(source, source_db, target, target_db, table, include_data).await
}

async fn compare_shared_table(
  source: Arc<EngineDriver>,
  source_db: &str,
  target: Arc<EngineDriver>,
  target_db: &str,
  table: &str,
  include_data: bool,
) -> Result<TableComparisonResult, String> {
  let source_schema = source.get_table_schema(source_db, table).await?;
  let target_schema = target.get_table_schema(target_db, table).await?;
  let column_diffs = diff_columns(&source_schema, &target_schema);
  let index_diffs = diff_indexes(&source_schema, &target_schema);

  let data_diff = if include_data {
    Some(
      diff_table_data(
        source,
        source_db,
        target,
        target_db,
        table,
        &source_schema,
        &target_schema,
      )
      .await?,
    )
  } else {
    None
  };

  Ok(build_table_comparison(table, column_diffs, index_diffs, data_diff))
}

/// 计算需要对比的表集合：有 filter 时用 filter，否则取两侧并集；去重并排序。
fn collect_diff_tables(
  source_tables: &[String],
  target_tables: &[String],
  filter: Option<&[String]>,
) -> Vec<String> {
  let set: BTreeSet<String> = match filter {
    Some(tables) if !tables.is_empty() => tables.iter().cloned().collect(),
    _ => source_tables
      .iter()
      .chain(target_tables.iter())
      .cloned()
      .collect(),
  };
  set.into_iter().collect()
}

fn only_table_diff(table: &str, kind: DiffKind) -> TableDiff {
  TableDiff {
    table: table.to_string(),
    kind,
    column_diffs: Vec::new(),
    index_diffs: Vec::new(),
    data_diff: None,
  }
}

/// 结构完全一致且行级无差异时 tableDiff 为 None；rowComparison 只要跑过数据对比就返回。
fn build_table_comparison(
  table: &str,
  column_diffs: Vec<ColumnDiff>,
  index_diffs: Vec<IndexDiff>,
  data_diff: Option<TableDataDiff>,
) -> TableComparisonResult {
  let row_comparison = data_diff.clone().map(|dd| TableRowComparison {
    table: table.to_string(),
    data_diff: dd,
  });

  let table_diff = if column_diffs.is_empty()
    && index_diffs.is_empty()
    && !has_meaningful_data_diff(data_diff.as_ref())
  {
    None
  } else {
    Some(TableDiff {
      table: table.to_string(),
      kind: DiffKind::Modified,
      column_diffs,
      index_diffs,
      data_diff,
    })
  };

  TableComparisonResult {
    table_diff,
    row_comparison,
  }
}

fn has_meaningful_data_diff(data_diff: Option<&TableDataDiff>) -> bool {
  match data_diff {
    Some(dd) => dd.comparable && (dd.source_only > 0 || dd.target_only > 0 || dd.modified > 0),
    None => false,
  }
}

/// 只输出有差异的列（identical 条目省略），先按源表列顺序、再补 target 独有列。
fn diff_columns(source: &TableSchema, target: &TableSchema) -> Vec<ColumnDiff> {
  let target_map: HashMap<&str, &ColumnInfo> =
    target.columns.iter().map(|c| (c.name.as_str(), c)).collect();
  let source_names: HashSet<&str> = source.columns.iter().map(|c| c.name.as_str()).collect();

  let mut diffs = Vec::new();
  for sc in &source.columns {
    match target_map.get(sc.name.as_str()) {
      None => diffs.push(ColumnDiff {
        name: sc.name.clone(),
        kind: DiffKind::OnlyInSource,
        source: Some(sc.clone()),
        target: None,
      }),
      Some(tc) if !same_column(sc, tc) => diffs.push(ColumnDiff {
        name: sc.name.clone(),
        kind: DiffKind::Modified,
        source: Some(sc.clone()),
        target: Some((*tc).clone()),
      }),
      Some(_) => {}
    }
  }
  for tc in &target.columns {
    if !source_names.contains(tc.name.as_str()) {
      diffs.push(ColumnDiff {
        name: tc.name.clone(),
        kind: DiffKind::OnlyInTarget,
        source: None,
        target: Some(tc.clone()),
      });
    }
  }
  diffs
}

fn same_column(a: &ColumnInfo, b: &ColumnInfo) -> bool {
  a.col_type == b.col_type
    && a.nullable == b.nullable
    && a.default_value == b.default_value
    && a.is_primary_key == b.is_primary_key
    && a.is_auto_increment == b.is_auto_increment
}

/// 只输出有差异的索引（identical 条目省略）。
fn diff_indexes(source: &TableSchema, target: &TableSchema) -> Vec<IndexDiff> {
  let target_map: HashMap<&str, &IndexInfo> =
    target.indexes.iter().map(|i| (i.name.as_str(), i)).collect();
  let source_names: HashSet<&str> = source.indexes.iter().map(|i| i.name.as_str()).collect();

  let mut diffs = Vec::new();
  for si in &source.indexes {
    match target_map.get(si.name.as_str()) {
      None => diffs.push(IndexDiff {
        name: si.name.clone(),
        kind: DiffKind::OnlyInSource,
        source: Some(si.clone()),
        target: None,
      }),
      Some(ti) if !same_index(si, ti) => diffs.push(IndexDiff {
        name: si.name.clone(),
        kind: DiffKind::Modified,
        source: Some(si.clone()),
        target: Some((*ti).clone()),
      }),
      Some(_) => {}
    }
  }
  for ti in &target.indexes {
    if !source_names.contains(ti.name.as_str()) {
      diffs.push(IndexDiff {
        name: ti.name.clone(),
        kind: DiffKind::OnlyInTarget,
        source: None,
        target: Some(ti.clone()),
      });
    }
  }
  diffs
}

fn same_index(a: &IndexInfo, b: &IndexInfo) -> bool {
  a.unique == b.unique && a.columns == b.columns && a.index_type == b.index_type
}

async fn diff_table_data(
  source: Arc<EngineDriver>,
  source_db: &str,
  target: Arc<EngineDriver>,
  target_db: &str,
  table: &str,
  source_schema: &TableSchema,
  target_schema: &TableSchema,
) -> Result<TableDataDiff, String> {
  let compare_columns = shared_compare_columns(source_schema, target_schema);
  if compare_columns.is_empty() {
    return Ok(not_comparable(
      "No shared columns available for row comparison",
      Vec::new(),
    ));
  }

  let (key_columns, reason) = match resolve_key_columns(
    &source_schema.primary_key,
    &target_schema.primary_key,
    &compare_columns,
  ) {
    Ok(resolved) => resolved,
    Err(reason) => return Ok(not_comparable(&reason, compare_columns)),
  };

  let source_rows = source
    .stream_rows_ordered(source_db, table, &key_columns, DATA_DIFF_BATCH_SIZE)
    .await?;
  let target_rows = target
    .stream_rows_ordered(target_db, table, &key_columns, DATA_DIFF_BATCH_SIZE)
    .await?;

  Ok(diff_rows(
    &source_rows,
    &target_rows,
    key_columns,
    compare_columns,
    reason,
  ))
}

/// 两侧共有的列，按源表列顺序。
fn shared_compare_columns(source: &TableSchema, target: &TableSchema) -> Vec<String> {
  let target_names: HashSet<&str> = target.columns.iter().map(|c| c.name.as_str()).collect();
  source
    .columns
    .iter()
    .map(|c| c.name.clone())
    .filter(|name| target_names.contains(name.as_str()))
    .collect()
}

/// 选取行配对的 key 列；没有可用主键时返回 Err（reason），此时 comparable=false，
/// 不再退化为全列 key（全列配对既慢又容易误报）。
fn resolve_key_columns(
  source_primary_key: &[String],
  target_primary_key: &[String],
  compare_columns: &[String],
) -> Result<(Vec<String>, Option<String>), String> {
  let compare_set: HashSet<&str> = compare_columns.iter().map(String::as_str).collect();
  let source_pk: Vec<String> = source_primary_key
    .iter()
    .filter(|c| compare_set.contains(c.as_str()))
    .cloned()
    .collect();
  let target_pk: Vec<String> = target_primary_key
    .iter()
    .filter(|c| compare_set.contains(c.as_str()))
    .cloned()
    .collect();

  if !source_pk.is_empty() && same_column_set(&source_pk, &target_pk) {
    return Ok((source_pk, None));
  }
  if !source_pk.is_empty() {
    return Ok((
      source_pk,
      Some("Target primary key differs, matched rows by source primary key columns".into()),
    ));
  }
  if !target_pk.is_empty() {
    return Ok((
      target_pk,
      Some("Source primary key differs, matched rows by target primary key columns".into()),
    ));
  }
  Err("No shared primary key available for row comparison".into())
}

fn same_column_set(source: &[String], target: &[String]) -> bool {
  if source.len() != target.len() {
    return false;
  }
  let target_set: HashSet<&str> = target.iter().map(String::as_str).collect();
  source.iter().all(|c| target_set.contains(c.as_str()))
}

fn not_comparable(reason: &str, compare_columns: Vec<String>) -> TableDataDiff {
  TableDataDiff {
    comparable: false,
    reason: Some(reason.to_string()),
    key_columns: Vec::new(),
    compare_columns,
    source_row_count: 0,
    target_row_count: 0,
    source_only: 0,
    target_only: 0,
    modified: 0,
    identical: 0,
    samples: Vec::new(),
  }
}

struct ComparableRow {
  /// 类型化后的规范 key（数值按数值比较，避免 {1,2,10} 被字符串序误报）。
  key: String,
  key_label: String,
  values: HashMap<String, Value>,
}

/// 纯函数：按 key 列配对两侧行，统计 identical/modified/sourceOnly/targetOnly 并采样。
/// 用 HashMap 配对而不是 merge-join，避免依赖两侧数据库排序规则一致。
fn diff_rows(
  source_rows: &[HashMap<String, Value>],
  target_rows: &[HashMap<String, Value>],
  key_columns: Vec<String>,
  compare_columns: Vec<String>,
  reason: Option<String>,
) -> TableDataDiff {
  let source_cmp: Vec<ComparableRow> = source_rows
    .iter()
    .map(|row| comparable_row(row, &key_columns, &compare_columns))
    .collect();
  let target_cmp: Vec<ComparableRow> = target_rows
    .iter()
    .map(|row| comparable_row(row, &key_columns, &compare_columns))
    .collect();

  let mut target_by_key: HashMap<&str, usize> = HashMap::new();
  for (idx, row) in target_cmp.iter().enumerate() {
    target_by_key.entry(row.key.as_str()).or_insert(idx);
  }

  let mut matched = vec![false; target_cmp.len()];
  let mut identical = 0i64;
  let mut modified = 0i64;
  let mut source_only = 0i64;
  let mut target_only = 0i64;
  let mut samples: Vec<TableDataDiffSample> = Vec::new();

  for row in &source_cmp {
    match target_by_key.get(row.key.as_str()) {
      Some(&idx) if !matched[idx] => {
        matched[idx] = true;
        let target_row = &target_cmp[idx];
        if row.values == target_row.values {
          identical += 1;
        } else {
          modified += 1;
          push_sample(
            &mut samples,
            TableDataDiffSample {
              kind: DiffKind::Modified,
              key: row.key_label.clone(),
              source: Some(row.values.clone()),
              target: Some(target_row.values.clone()),
            },
          );
        }
      }
      _ => {
        source_only += 1;
        push_sample(
          &mut samples,
          TableDataDiffSample {
            kind: DiffKind::OnlyInSource,
            key: row.key_label.clone(),
            source: Some(row.values.clone()),
            target: None,
          },
        );
      }
    }
  }

  for (idx, row) in target_cmp.iter().enumerate() {
    if !matched[idx] {
      target_only += 1;
      push_sample(
        &mut samples,
        TableDataDiffSample {
          kind: DiffKind::OnlyInTarget,
          key: row.key_label.clone(),
          source: None,
          target: Some(row.values.clone()),
        },
      );
    }
  }

  TableDataDiff {
    comparable: true,
    reason,
    key_columns,
    compare_columns,
    source_row_count: source_rows.len() as i64,
    target_row_count: target_rows.len() as i64,
    source_only,
    target_only,
    modified,
    identical,
    samples,
  }
}

fn push_sample(samples: &mut Vec<TableDataDiffSample>, sample: TableDataDiffSample) {
  if samples.len() >= DATA_DIFF_SAMPLE_LIMIT {
    return;
  }
  samples.push(sample);
}

fn comparable_row(
  row: &HashMap<String, Value>,
  key_columns: &[String],
  compare_columns: &[String],
) -> ComparableRow {
  let mut values = HashMap::with_capacity(compare_columns.len());
  for column in compare_columns {
    values.insert(
      column.clone(),
      row.get(column).cloned().unwrap_or(Value::Null),
    );
  }

  let key = key_columns
    .iter()
    .map(|column| canonical_key_part(values.get(column).unwrap_or(&Value::Null)))
    .collect::<Vec<_>>()
    .join("\u{1}");
  let key_label = key_columns
    .iter()
    .map(|column| {
      format!(
        "{column}={}",
        preview_value(values.get(column).unwrap_or(&Value::Null))
      )
    })
    .collect::<Vec<_>>()
    .join(", ");

  ComparableRow {
    key,
    key_label,
    values,
  }
}

/// 类型化 key：数字统一成数值文本（整数不带小数点），带类型前缀防止 1 和 "1" 撞 key。
fn canonical_key_part(value: &Value) -> String {
  match value {
    Value::Null => "null".into(),
    Value::Bool(b) => format!("b:{b}"),
    Value::Number(n) => {
      if let Some(i) = n.as_i64() {
        format!("n:{i}")
      } else if let Some(u) = n.as_u64() {
        format!("n:{u}")
      } else {
        format!("n:{}", n.as_f64().unwrap_or(f64::NAN))
      }
    }
    Value::String(s) => format!("s:{s}"),
    other => format!("j:{other}"),
  }
}

fn preview_value(value: &Value) -> String {
  let text = match value {
    Value::Null => return "NULL".into(),
    Value::String(s) => s.clone(),
    other => other.to_string(),
  };
  if text.chars().count() > SAMPLE_PREVIEW_MAX_CHARS {
    let truncated: String = text.chars().take(SAMPLE_PREVIEW_MAX_CHARS - 3).collect();
    format!("{truncated}...")
  } else {
    text
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn column(
    name: &str,
    col_type: &str,
    nullable: bool,
    is_primary_key: bool,
    is_auto_increment: bool,
  ) -> ColumnInfo {
    ColumnInfo {
      name: name.into(),
      col_type: col_type.into(),
      nullable,
      default_value: None,
      is_primary_key,
      is_auto_increment,
      comment: String::new(),
      column_key: if is_primary_key { "PRI".into() } else { String::new() },
    }
  }

  fn index(name: &str, columns: &[&str], unique: bool) -> IndexInfo {
    IndexInfo {
      name: name.into(),
      columns: columns.iter().map(|c| c.to_string()).collect(),
      unique,
      index_type: "BTREE".into(),
    }
  }

  fn schema(name: &str, columns: Vec<ColumnInfo>, indexes: Vec<IndexInfo>) -> TableSchema {
    let primary_key = columns
      .iter()
      .filter(|c| c.is_primary_key)
      .map(|c| c.name.clone())
      .collect();
    TableSchema {
      name: name.into(),
      columns,
      indexes,
      primary_key,
      create_sql: format!("CREATE TABLE {name} (...)"),
      row_estimate: None,
      engine: None,
      charset: None,
      table_comment: None,
      data_length: None,
      index_length: None,
      data_free: None,
      avg_row_length: None,
      auto_increment: None,
      created_at: None,
      updated_at: None,
    }
  }

  fn row(value: Value) -> HashMap<String, Value> {
    serde_json::from_value(value).expect("row literal")
  }

  // 移植自 diff-service.schema-cases.ts: 'returns source-only and target-only tables ...'
  #[test]
  fn source_only_and_target_only_tables_become_table_diff_entries() {
    let tables = collect_diff_tables(
      &["only_source".into()],
      &["only_target".into()],
      None,
    );
    assert_eq!(tables, vec!["only_source".to_string(), "only_target".to_string()]);

    let source_only = only_table_diff("only_source", DiffKind::OnlyInSource);
    let target_only = only_table_diff("only_target", DiffKind::OnlyInTarget);
    assert_eq!(
      serde_json::to_value([source_only, target_only]).unwrap(),
      json!([
        { "table": "only_source", "kind": "only-in-source", "columnDiffs": [], "indexDiffs": [] },
        { "table": "only_target", "kind": "only-in-target", "columnDiffs": [], "indexDiffs": [] }
      ])
    );
  }

  // 移植自 diff-service.schema-cases.ts: 'returns modified diffs for changed shared tables'
  #[test]
  fn modified_shared_table_reports_column_and_index_diffs() {
    let source = schema(
      "shared",
      vec![
        column("id", "int", false, true, true),
        column("name", "varchar(64)", false, false, false),
      ],
      vec![index("PRIMARY", &["id"], true), index("idx_name", &["name"], false)],
    );
    let target = schema(
      "shared",
      vec![
        column("id", "int", false, true, true),
        column("name", "varchar(128)", false, false, false),
      ],
      vec![index("PRIMARY", &["id"], true)],
    );

    let column_diffs = diff_columns(&source, &target);
    let index_diffs = diff_indexes(&source, &target);
    assert_eq!(column_diffs.len(), 1);
    assert_eq!(column_diffs[0].name, "name");
    assert_eq!(column_diffs[0].kind, DiffKind::Modified);
    assert_eq!(index_diffs.len(), 1);
    assert_eq!(index_diffs[0].name, "idx_name");
    assert_eq!(index_diffs[0].kind, DiffKind::OnlyInSource);

    let result = build_table_comparison("shared", column_diffs, index_diffs, None);
    let table_diff = result.table_diff.expect("table diff");
    assert_eq!(table_diff.table, "shared");
    assert_eq!(table_diff.kind, DiffKind::Modified);
  }

  // 移植自 diff-service.schema-cases.ts: 'filters out shared tables when schemas are identical'
  #[test]
  fn identical_schemas_produce_no_table_diff() {
    let make = || {
      schema(
        "shared",
        vec![
          column("id", "int", false, true, true),
          column("title", "varchar(255)", false, false, false),
        ],
        vec![index("PRIMARY", &["id"], true), index("idx_title", &["title"], false)],
      )
    };
    let source = make();
    let target = make();

    let column_diffs = diff_columns(&source, &target);
    let index_diffs = diff_indexes(&source, &target);
    assert!(column_diffs.is_empty());
    assert!(index_diffs.is_empty());

    let result = build_table_comparison("shared", column_diffs, index_diffs, None);
    assert!(result.table_diff.is_none());
    assert!(result.row_comparison.is_none());
  }

  // 移植自 diff-service.schema-cases.ts: 'limits database diffs to the requested table filter'
  #[test]
  fn table_filter_limits_database_diff() {
    let source_tables = vec!["other".to_string(), "shared".to_string()];
    let target_tables = vec!["other".to_string(), "shared".to_string()];
    let filter = vec!["shared".to_string()];
    assert_eq!(
      collect_diff_tables(&source_tables, &target_tables, Some(&filter)),
      vec!["shared".to_string()]
    );
    // 空 filter 等价于不过滤。
    assert_eq!(
      collect_diff_tables(&source_tables, &target_tables, Some(&[])),
      vec!["other".to_string(), "shared".to_string()]
    );
  }

  // 移植自 diff-service.data-cases.ts: 'returns row-level diffs for shared tables ...'
  #[test]
  fn row_level_diffs_for_shared_tables() {
    let source_rows = vec![
      row(json!({ "id": 1, "name": "Alice" })),
      row(json!({ "id": 2, "name": "Bob" })),
    ];
    let target_rows = vec![
      row(json!({ "id": 1, "name": "Alice" })),
      row(json!({ "id": 2, "name": "Robert" })),
      row(json!({ "id": 3, "name": "Carol" })),
    ];

    let diff = diff_rows(
      &source_rows,
      &target_rows,
      vec!["id".into()],
      vec!["id".into(), "name".into()],
      None,
    );

    assert!(diff.comparable);
    assert_eq!(diff.key_columns, vec!["id".to_string()]);
    assert_eq!(diff.source_row_count, 2);
    assert_eq!(diff.target_row_count, 3);
    assert_eq!(diff.source_only, 0);
    assert_eq!(diff.target_only, 1);
    assert_eq!(diff.modified, 1);
    assert_eq!(diff.identical, 1);
    assert_eq!(
      serde_json::to_value(&diff.samples).unwrap(),
      json!([
        {
          "kind": "modified",
          "key": "id=2",
          "source": { "id": 2, "name": "Bob" },
          "target": { "id": 2, "name": "Robert" }
        },
        {
          "kind": "only-in-target",
          "key": "id=3",
          "target": { "id": 3, "name": "Carol" }
        }
      ])
    );

    let result = build_table_comparison("shared", Vec::new(), Vec::new(), Some(diff));
    let table_diff = result.table_diff.expect("table diff");
    assert_eq!(table_diff.kind, DiffKind::Modified);
    assert!(table_diff.data_diff.is_some());
    assert_eq!(result.row_comparison.expect("row comparison").table, "shared");
  }

  // 移植自 diff-service.data-cases.ts: 'returns row comparison results even when rows are identical'
  #[test]
  fn identical_rows_still_produce_row_comparison() {
    let rows = vec![row(json!({ "id": 1, "name": "Alice" }))];

    let diff = diff_rows(
      &rows,
      &rows,
      vec!["id".into()],
      vec!["id".into(), "name".into()],
      None,
    );
    assert_eq!(
      serde_json::to_value(&diff).unwrap(),
      json!({
        "comparable": true,
        "keyColumns": ["id"],
        "compareColumns": ["id", "name"],
        "sourceRowCount": 1,
        "targetRowCount": 1,
        "sourceOnly": 0,
        "targetOnly": 0,
        "modified": 0,
        "identical": 1,
        "samples": []
      })
    );

    let result = build_table_comparison("shared", Vec::new(), Vec::new(), Some(diff));
    assert!(result.table_diff.is_none(), "identical rows must not emit a tableDiff");
    let row_comparison = result.row_comparison.expect("row comparison");
    assert_eq!(row_comparison.table, "shared");
    assert_eq!(row_comparison.data_diff.identical, 1);
  }

  // 数值主键回归：ORDER BY pk 返回数值序 {1,2,10}，字符串比较会把 10 误报为两侧独有。
  #[test]
  fn numeric_primary_keys_match_by_value_not_string_order() {
    let source_rows = vec![
      row(json!({ "id": 1, "name": "a" })),
      row(json!({ "id": 2, "name": "b" })),
      row(json!({ "id": 10, "name": "j" })),
    ];
    let target_rows = vec![
      row(json!({ "id": 1, "name": "a" })),
      row(json!({ "id": 2, "name": "b" })),
      row(json!({ "id": 3, "name": "c" })),
      row(json!({ "id": 10, "name": "j" })),
    ];

    let diff = diff_rows(
      &source_rows,
      &target_rows,
      vec!["id".into()],
      vec!["id".into(), "name".into()],
      None,
    );

    assert_eq!(diff.identical, 3);
    assert_eq!(diff.modified, 0);
    assert_eq!(diff.source_only, 0);
    assert_eq!(diff.target_only, 1);
    assert_eq!(diff.samples.len(), 1);
    assert_eq!(diff.samples[0].kind, DiffKind::OnlyInTarget);
    assert_eq!(diff.samples[0].key, "id=3");
  }

  // 无主键时不再退化为全列 key，改为 comparable=false + reason。
  #[test]
  fn missing_primary_key_marks_data_diff_not_comparable() {
    let compare_columns = vec!["a".to_string(), "b".to_string()];
    let err = resolve_key_columns(&[], &[], &compare_columns).expect_err("no key expected");
    assert_eq!(err, "No shared primary key available for row comparison");

    let diff = not_comparable(&err, compare_columns.clone());
    assert!(!diff.comparable);
    assert_eq!(diff.reason.as_deref(), Some(err.as_str()));
    assert_eq!(diff.key_columns, Vec::<String>::new());
    assert_eq!(diff.compare_columns, compare_columns);
    assert!(!has_meaningful_data_diff(Some(&diff)));
  }

  #[test]
  fn key_column_resolution_prefers_shared_primary_key() {
    let compare = vec!["id".to_string(), "name".to_string()];

    let (keys, reason) =
      resolve_key_columns(&["id".into()], &["id".into()], &compare).expect("shared pk");
    assert_eq!(keys, vec!["id".to_string()]);
    assert!(reason.is_none());

    let (keys, reason) =
      resolve_key_columns(&["id".into()], &["name".into()], &compare).expect("source pk");
    assert_eq!(keys, vec!["id".to_string()]);
    assert_eq!(
      reason.as_deref(),
      Some("Target primary key differs, matched rows by source primary key columns")
    );

    let (keys, reason) = resolve_key_columns(&[], &["name".into()], &compare).expect("target pk");
    assert_eq!(keys, vec!["name".to_string()]);
    assert_eq!(
      reason.as_deref(),
      Some("Source primary key differs, matched rows by target primary key columns")
    );
  }

  // serde 往返：手写符合 src/shared/types.ts 契约的 JSON 字面量，反序列化后再序列化必须逐字节还原。
  #[test]
  fn serde_round_trip_matches_shared_contract() {
    let database_diff = json!({
      "sourceDatabase": "source_db",
      "targetDatabase": "target_db",
      "tableDiffs": [
        { "table": "only_source", "kind": "only-in-source", "columnDiffs": [], "indexDiffs": [] },
        {
          "table": "shared",
          "kind": "modified",
          "columnDiffs": [
            {
              "name": "name",
              "kind": "modified",
              "source": {
                "name": "name",
                "type": "varchar(64)",
                "nullable": false,
                "defaultValue": null,
                "isPrimaryKey": false,
                "isAutoIncrement": false,
                "comment": "",
                "columnKey": ""
              },
              "target": {
                "name": "name",
                "type": "varchar(128)",
                "nullable": false,
                "defaultValue": null,
                "isPrimaryKey": false,
                "isAutoIncrement": false,
                "comment": "",
                "columnKey": ""
              }
            }
          ],
          "indexDiffs": [
            {
              "name": "idx_name",
              "kind": "only-in-source",
              "source": { "name": "idx_name", "columns": ["name"], "unique": false, "type": "BTREE" }
            }
          ],
          "dataDiff": {
            "comparable": true,
            "keyColumns": ["id"],
            "compareColumns": ["id", "name"],
            "sourceRowCount": 2,
            "targetRowCount": 3,
            "sourceOnly": 0,
            "targetOnly": 1,
            "modified": 1,
            "identical": 1,
            "samples": [
              {
                "kind": "only-in-target",
                "key": "id=3",
                "target": { "id": 3, "name": "Carol" }
              }
            ]
          }
        }
      ],
      "rowComparisons": [
        {
          "table": "shared",
          "dataDiff": {
            "comparable": false,
            "reason": "No shared primary key available for row comparison",
            "keyColumns": [],
            "compareColumns": ["id", "name"],
            "sourceRowCount": 0,
            "targetRowCount": 0,
            "sourceOnly": 0,
            "targetOnly": 0,
            "modified": 0,
            "identical": 0,
            "samples": []
          }
        }
      ]
    });
    let parsed: DatabaseDiff = serde_json::from_value(database_diff.clone()).expect("DatabaseDiff");
    assert_eq!(serde_json::to_value(&parsed).unwrap(), database_diff);

    // tableDiff/rowComparison 为 null 时按契约序列化为显式 null。
    let comparison = json!({ "tableDiff": null, "rowComparison": null });
    let parsed: TableComparisonResult =
      serde_json::from_value(comparison.clone()).expect("TableComparisonResult");
    assert_eq!(serde_json::to_value(&parsed).unwrap(), comparison);

    // UI 发送的请求载荷（diff-panel-hooks.ts / table-diff-request.ts）必须能被反序列化。
    let table_request = json!({
      "sourceConnectionId": "source-conn",
      "sourceDatabase": "source_db",
      "targetConnectionId": "target-conn",
      "targetDatabase": "target_db",
      "table": "shared",
      "includeData": true
    });
    let parsed: crate::types::TableDiffRequest =
      serde_json::from_value(table_request).expect("TableDiffRequest");
    assert_eq!(parsed.table, "shared");
    assert_eq!(parsed.include_data, Some(true));

    let database_request = json!({
      "sourceConnectionId": "source-conn",
      "sourceDatabase": "source_db",
      "targetConnectionId": "target-conn",
      "targetDatabase": "target_db",
      "includeData": false,
      "tables": ["shared"]
    });
    let parsed: crate::types::DiffRequest =
      serde_json::from_value(database_request).expect("DiffRequest");
    assert_eq!(parsed.tables, Some(vec!["shared".to_string()]));
    assert_eq!(parsed.include_data, Some(false));
  }
}
