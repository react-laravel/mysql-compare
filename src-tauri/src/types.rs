use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DbEngine {
  Mysql,
  Postgres,
  Redis,
}

impl Default for DbEngine {
  fn default() -> Self {
    Self::Mysql
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCredentialConfig {
  pub username: Option<String>,
  pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeDatabaseCredential {
  pub username: Option<String>,
  pub has_password: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
  pub id: String,
  #[serde(default)]
  pub engine: DbEngine,
  pub name: String,
  pub group: Option<String>,
  pub host: String,
  pub port: u16,
  pub username: String,
  pub password: Option<String>,
  pub database_credentials: Option<HashMap<String, DatabaseCredentialConfig>>,
  pub database: Option<String>,
  #[serde(rename = "useSSH", default)]
  pub use_ssh: bool,
  pub ssh_host: Option<String>,
  pub ssh_port: Option<u16>,
  pub ssh_username: Option<String>,
  pub ssh_password: Option<String>,
  pub ssh_private_key: Option<String>,
  pub ssh_private_key_path: Option<String>,
  pub ssh_passphrase: Option<String>,
  #[serde(default)]
  pub ssh_source_connection_id: Option<String>,
  pub created_at: i64,
  pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeConnection {
  pub id: String,
  pub engine: DbEngine,
  pub name: String,
  pub group: Option<String>,
  pub host: String,
  pub port: u16,
  pub username: String,
  pub database: Option<String>,
  #[serde(rename = "useSSH")]
  pub use_ssh: bool,
  pub ssh_host: Option<String>,
  pub ssh_port: Option<u16>,
  pub ssh_username: Option<String>,
  pub ssh_private_key_path: Option<String>,
  pub created_at: i64,
  pub updated_at: i64,
  pub has_password: bool,
  pub database_credentials: Option<HashMap<String, SafeDatabaseCredential>>,
  #[serde(rename = "hasSSHPassword")]
  pub has_ssh_password: bool,
  #[serde(rename = "hasSSHPrivateKey")]
  pub has_ssh_private_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
  pub name: String,
  #[serde(rename = "type")]
  pub col_type: String,
  pub nullable: bool,
  pub default_value: Option<String>,
  pub is_primary_key: bool,
  pub is_auto_increment: bool,
  pub comment: String,
  pub column_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
  pub name: String,
  pub columns: Vec<String>,
  pub unique: bool,
  #[serde(rename = "type")]
  pub index_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSchema {
  pub name: String,
  pub columns: Vec<ColumnInfo>,
  pub indexes: Vec<IndexInfo>,
  pub primary_key: Vec<String>,
  #[serde(rename = "createSQL", alias = "createSql")]
  pub create_sql: String,
  pub row_estimate: Option<i64>,
  pub engine: Option<String>,
  pub charset: Option<String>,
  pub table_comment: Option<String>,
  pub data_length: Option<i64>,
  pub index_length: Option<i64>,
  pub data_free: Option<i64>,
  pub avg_row_length: Option<i64>,
  pub auto_increment: Option<i64>,
  pub created_at: Option<String>,
  pub updated_at: Option<String>,
}

#[cfg(test)]
mod table_schema_tests {
  use super::TableSchema;

  #[test]
  fn serializes_create_sql_with_the_frontend_field_name() {
    let schema = TableSchema {
      name: "users".into(),
      columns: vec![],
      indexes: vec![],
      primary_key: vec![],
      create_sql: "CREATE TABLE `users` (`id` bigint)".into(),
      row_estimate: Some(1),
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
    };

    let value = serde_json::to_value(schema).expect("serialize table schema");
    assert_eq!(
      value.get("createSQL").and_then(|value| value.as_str()),
      Some("CREATE TABLE `users` (`id` bigint)")
    );
    assert!(value.get("createSql").is_none());
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
  pub name: String,
  pub table_count: i64,
  pub row_estimate: Option<i64>,
  pub data_length: Option<i64>,
  pub index_length: Option<i64>,
  pub total_size: Option<i64>,
  pub data_free: Option<i64>,
  pub charset: Option<String>,
  pub collation: Option<String>,
  pub owner: Option<String>,
  pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderBy {
  pub column: String,
  pub dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRowsRequest {
  pub connection_id: String,
  pub database: String,
  pub table: String,
  pub page: u32,
  pub page_size: u32,
  pub order_by: Option<OrderBy>,
  pub where_clause: Option<String>,
  #[serde(default, rename = "where")]
  pub where_sql: Option<String>,
  pub primary_key: Option<Vec<String>>,
  pub column_names: Option<Vec<String>>,
}

impl QueryRowsRequest {
  pub fn where_fragment(&self) -> Option<&str> {
    self
      .where_sql
      .as_deref()
      .or(self.where_clause.as_deref())
      .map(str::trim)
      .filter(|s| !s.is_empty())
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRowsResult {
  pub rows: Vec<HashMap<String, Value>>,
  pub total: i64,
  pub has_primary_key: bool,
  pub primary_key: Vec<String>,
  pub columns: Vec<ColumnInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertRowRequest {
  pub connection_id: String,
  pub database: String,
  pub table: String,
  pub values: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRowRequest {
  pub connection_id: String,
  pub database: String,
  pub table: String,
  pub pk_values: HashMap<String, Value>,
  pub changes: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRowsRequest {
  pub connection_id: String,
  pub database: String,
  pub table: String,
  pub pk_rows: Vec<HashMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameTableRequest {
  pub connection_id: String,
  pub database: String,
  pub table: String,
  pub new_table: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyTableRequest {
  pub connection_id: String,
  pub database: String,
  pub table: String,
  pub target_table: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropTableRequest {
  pub connection_id: String,
  pub database: String,
  pub table: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropDatabaseRequest {
  pub connection_id: String,
  pub database: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TruncateTableRequest {
  pub connection_id: String,
  pub database: String,
  pub table: String,
  pub reset_identity: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainSQLRequest {
  pub connection_id: String,
  pub database: Option<String>,
  pub sql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainPlanMetric {
  pub label: String,
  pub value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainPlanNode {
  pub id: String,
  pub label: String,
  pub detail: Option<String>,
  pub metrics: Vec<ExplainPlanMetric>,
  pub children: Vec<ExplainPlanNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainSQLResult {
  pub engine: String,
  pub statement: String,
  pub summary: Vec<ExplainPlanMetric>,
  pub plan: Option<ExplainPlanNode>,
  pub columns: Vec<String>,
  pub rows: Vec<HashMap<String, Value>>,
  pub raw: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTableRequest {
  pub connection_id: String,
  pub database: String,
  pub table: String,
  pub format: String,
  pub sql_dialect: Option<String>,
  pub scope: String,
  #[serde(default, rename = "where")]
  pub where_sql: Option<String>,
  pub order_by: Option<OrderBy>,
  pub page: Option<u32>,
  pub page_size: Option<u32>,
  pub selected_rows: Option<Vec<HashMap<String, Value>>>,
  pub include_create_table: Option<bool>,
  pub include_data: Option<bool>,
  pub include_headers: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTableResult {
  pub canceled: bool,
  pub file_path: Option<String>,
  pub rows_exported: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDatabaseRequest {
  pub connection_id: String,
  pub database: String,
  pub format: String,
  pub sql_dialect: Option<String>,
  pub backend: Option<String>,
  pub include_create_table: Option<bool>,
  pub include_data: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDatabaseResult {
  pub canceled: bool,
  pub file_path: Option<String>,
  pub tables_exported: i64,
  pub rows_exported: i64,
  pub backend: Option<String>,
  pub rows_count_accurate: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTableRequest {
  pub connection_id: String,
  pub database: String,
  pub table: String,
  pub format: String,
  pub include_headers: Option<bool>,
  pub empty_as_null: Option<bool>,
  pub file_name: Option<String>,
  pub file_content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTableResult {
  pub canceled: bool,
  pub file_path: Option<String>,
  pub rows_imported: i64,
  pub statements_executed: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRequest {
  pub source_connection_id: String,
  pub source_database: String,
  pub target_connection_id: String,
  pub target_database: String,
  pub compare_data: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDiffRequest {
  pub source_connection_id: String,
  pub source_database: String,
  pub source_table: String,
  pub target_connection_id: String,
  pub target_database: String,
  pub target_table: String,
  pub compare_data: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDiff {
  pub name: String,
  pub status: String,
  pub source: Option<ColumnInfo>,
  pub target: Option<ColumnInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDiff {
  pub name: String,
  pub status: String,
  pub source: Option<IndexInfo>,
  pub target: Option<IndexInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataDiff {
  pub identical: i64,
  pub modified: i64,
  pub source_only: i64,
  pub target_only: i64,
  pub samples: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDiff {
  pub table: String,
  pub status: String,
  pub column_diffs: Vec<ColumnDiff>,
  pub index_diffs: Vec<IndexDiff>,
  pub data_diff: Option<TableDataDiff>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDiff {
  pub source_only_tables: Vec<String>,
  pub target_only_tables: Vec<String>,
  pub table_diffs: Vec<TableDiff>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableComparisonResult {
  pub table_diff: Option<TableDiff>,
  pub row_comparison: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
  pub source_connection_id: String,
  pub source_database: String,
  pub target_connection_id: String,
  pub target_database: String,
  pub tables: Vec<String>,
  pub sync_structure: Option<bool>,
  pub sync_data: Option<bool>,
  pub existing_table_strategy: Option<String>,
  pub dry_run: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlanStep {
  pub table: String,
  pub action: String,
  pub sql: Option<String>,
  pub row_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlan {
  pub steps: Vec<SyncPlanStep>,
  pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgressEvent {
  pub table: String,
  pub step: String,
  pub done: i64,
  pub total: i64,
  pub message: Option<String>,
  pub level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SSHListFilesRequest {
  pub connection_id: String,
  pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SSHFileEntry {
  pub name: String,
  pub path: String,
  #[serde(rename = "type")]
  pub entry_type: String,
  pub size: u64,
  pub modified_at: Option<i64>,
  pub permissions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SSHListFilesResult {
  pub path: String,
  pub parent_path: Option<String>,
  pub entries: Vec<SSHFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SSHFileOperationResult {
  pub canceled: bool,
  pub local_path: Option<String>,
  pub remote_path: Option<String>,
  pub path: Option<String>,
  pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SSHPathRequest {
  pub connection_id: String,
  pub remote_path: Option<String>,
  pub remote_dir: Option<String>,
  pub path: Option<String>,
  pub name: Option<String>,
  pub content: Option<String>,
  pub from_path: Option<String>,
  pub to_path: Option<String>,
  pub next_path: Option<String>,
  pub entries: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SSHReadFileResult {
  pub path: String,
  pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SSHTerminalCreateRequest {
  pub connection_id: String,
  pub cols: Option<u32>,
  pub rows: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SSHTerminalCreateResult {
  pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SSHTerminalWriteRequest {
  pub session_id: String,
  pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SSHTerminalResizeRequest {
  pub session_id: String,
  pub cols: u32,
  pub rows: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SSHTerminalCloseRequest {
  pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SSHTerminalDataEvent {
  pub session_id: String,
  pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SSHTerminalExitEvent {
  pub session_id: String,
  pub message: Option<String>,
}
