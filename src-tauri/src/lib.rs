mod commands;
mod diff;
mod drivers;
mod export_import;
mod ipc;
mod secret_crypto;
mod ssh;
mod state;
mod store;
mod sync;
mod types;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      let state = AppState::new(app.handle())?;
      app.manage(state);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::connection::connection_list,
      commands::connection::connection_upsert,
      commands::connection::connection_remove,
      commands::connection::connection_close,
      commands::connection::connection_set_database_credential,
      commands::connection::connection_test_database_credential,
      commands::connection::connection_test,
      commands::db::db_list_databases,
      commands::db::db_get_database_info,
      commands::db::db_list_tables,
      commands::db::db_query_rows,
      commands::db::db_insert_row,
      commands::db::db_update_row,
      commands::db::db_delete_rows,
      commands::db::db_execute_sql,
      commands::db::db_explain_sql,
      commands::db::db_rename_table,
      commands::db::db_copy_table,
      commands::db::db_drop_database,
      commands::db::db_drop_table,
      commands::db::db_truncate_table,
      commands::db::db_export_table,
      commands::db::db_export_database,
      commands::db::db_import_table,
      commands::schema::schema_get_table,
      commands::ssh::ssh_list_files,
      commands::ssh::ssh_upload_file,
      commands::ssh::ssh_upload_directory,
      commands::ssh::ssh_upload_entries,
      commands::ssh::ssh_download_file,
      commands::ssh::ssh_download_directory,
      commands::ssh::ssh_read_file,
      commands::ssh::ssh_write_file,
      commands::ssh::ssh_create_directory,
      commands::ssh::ssh_delete_file,
      commands::ssh::ssh_move_file,
      commands::ssh::ssh_terminal_create,
      commands::ssh::ssh_terminal_write,
      commands::ssh::ssh_terminal_resize,
      commands::ssh::ssh_terminal_close,
      commands::diff::diff_databases,
      commands::diff::diff_table,
      commands::sync::sync_build_plan,
      commands::sync::sync_execute,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
