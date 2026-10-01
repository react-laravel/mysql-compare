use tauri::State;
use crate::{ipc::IpcResult, state::AppState};
#[tauri::command]
pub fn operation_cancel(state: State<'_, AppState>, operation_id: String) -> IpcResult<()> {
  crate::ipc::map_result(state.operations.cancel(&operation_id))
}
