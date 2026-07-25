use tauri::{AppHandle, State};

use crate::ipc::IpcResult;
use crate::state::AppState;
use crate::types::TableSchema;

#[tauri::command]
pub async fn schema_get_table(
  app: AppHandle,
  state: State<'_, AppState>,
  connection_id: String,
  database: String,
  table: String,
) -> Result<IpcResult<TableSchema>, String> {
  match state.get_driver(&app, &connection_id).await {
    Ok(d) => match d.get_table_schema(&database, &table).await {
      Ok(v) => Ok(IpcResult::ok(v)),
      Err(e) => Ok(IpcResult::err(e)),
    },
    Err(e) => Ok(IpcResult::err(e)),
  }
}
