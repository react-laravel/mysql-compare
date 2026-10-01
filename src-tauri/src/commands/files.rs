use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use crate::{ipc::IpcResult, state::AppState};
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SelectedFile { path: String, grant_id: String }
#[tauri::command]
pub async fn file_pick(app: AppHandle, state: State<'_, AppState>, purpose: String, default_name: Option<String>) -> Result<IpcResult<Vec<SelectedFile>>, String> {
  let purpose_for_dialog = purpose.clone();
  let paths = tokio::task::spawn_blocking(move || {
    let mut dialog = app.dialog().file();
    // Renderer only supplies a file name, never an initial arbitrary directory.
    if let Some(name) = default_name { if !name.contains(['/', '\\']) && name.len() < 256 { dialog = dialog.set_file_name(name); } }
    let paths = match purpose_for_dialog.as_str() {
      "export_table" | "export_database" | "ssh_download_file" => dialog.blocking_save_file().map(|p| vec![p]),
      "import_table" | "ssh_upload_file" => dialog.blocking_pick_file().map(|p| vec![p]),
      "ssh_upload_directory" | "ssh_download_directory" => dialog.blocking_pick_folder().map(|p| vec![p]),
      "ssh_upload_entries" => dialog.blocking_pick_files(),
      _ => return Err("Unknown file selection purpose".to_string()),
    };
    paths.unwrap_or_default().into_iter().map(|p| p.into_path().map_err(|e| e.to_string())).collect::<Result<Vec<_>, _>>()
  }).await.map_err(|e| e.to_string())??;
  let grants = state.file_grants.issue_many(&purpose, &paths)?;
  let mut selected = Vec::new();
  for (path, grant_id) in paths.into_iter().zip(grants) {
    selected.push(SelectedFile { grant_id, path: path.to_str().ok_or("Invalid local path encoding")?.into() });
  }
  Ok(IpcResult::ok(selected))
}
