import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { AppAPI } from '../../shared/app-api'
import type {
  ConnectionConfig,
  CopyTableRequest,
  DatabaseCredentialConfig,
  DatabaseDiff,
  DatabaseInfo,
  DeleteRowsRequest,
  DiffRequest,
  DropDatabaseRequest,
  DropTableRequest,
  ExportDatabaseRequest,
  ExportDatabaseResult,
  ExplainSQLRequest,
  ExplainSQLResult,
  ExportTableRequest,
  ExportTableResult,
  ImportTableRequest,
  ImportTableResult,
  InsertRowRequest,
  IPCResult,
  QueryRowsRequest,
  QueryRowsResult,
  RenameTableRequest,
  SafeConnection,
  SSHCreateDirectoryRequest,
  SSHDeleteFileRequest,
  SSHDownloadDirectoryRequest,
  SSHDownloadFileRequest,
  SSHFileOperationResult,
  SSHListFilesRequest,
  SSHListFilesResult,
  SSHMoveFileRequest,
  SSHReadFileRequest,
  SSHReadFileResult,
  SSHTerminalCloseRequest,
  SSHTerminalCreateRequest,
  SSHTerminalCreateResult,
  SSHTerminalDataEvent,
  SSHTerminalExitEvent,
  SSHTerminalResizeRequest,
  SSHTerminalWriteRequest,
  SSHUploadDirectoryRequest,
  SSHUploadEntriesRequest,
  SSHUploadFileRequest,
  SSHWriteFileRequest,
  SyncPlan,
  SyncProgressEvent,
  SyncRequest,
  TableComparisonResult,
  TableDiffRequest,
  TableSchema,
  TruncateTableRequest,
  UpdateRowRequest
} from '../../shared/types'

async function wrap<T>(fn: () => Promise<IPCResult<T>>): Promise<IPCResult<T>> {
  try {
    return await fn()
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | null = null
  void listen<T>(event, (e) => {
    callback(e.payload)
  }).then((fn) => {
    unlisten = fn
  })
  return () => {
    unlisten?.()
  }
}

async function pickLocalPaths(options: {
  multiple?: boolean
  directory?: boolean
}): Promise<string[]> {
  const selected = await open({
    multiple: options.multiple ?? false,
    directory: options.directory ?? false
  })
  if (selected == null) return []
  return Array.isArray(selected) ? selected : [selected]
}

export function createTauriApi(): AppAPI {
  return {
    runtime: {
      mode: 'tauri',
      supportsNativeFilePicker: true,
      supportsDirectoryUpload: true,
      supportsTerminalStreaming: true,
      supportsDownload: true
    },
    connection: {
      list: () => wrap(() => invoke<IPCResult<SafeConnection[]>>('connection_list')),
      upsert: (conn: ConnectionConfig) =>
        wrap(() => invoke<IPCResult<SafeConnection>>('connection_upsert', { conn })),
      remove: (id: string) => wrap(() => invoke<IPCResult<void>>('connection_remove', { id })),
      close: (id: string) => wrap(() => invoke<IPCResult<void>>('connection_close', { id })),
      setDatabaseCredential: (id, database, credential: DatabaseCredentialConfig) =>
        wrap(() =>
          invoke<IPCResult<SafeConnection>>('connection_set_database_credential', {
            id,
            database,
            credential
          })
        ),
      testDatabaseCredential: (id, database, credential: DatabaseCredentialConfig) =>
        wrap(() =>
          invoke<IPCResult<{ message: string }>>('connection_test_database_credential', {
            id,
            database,
            credential
          })
        ),
      test: (conn: ConnectionConfig) =>
        wrap(() => invoke<IPCResult<{ message: string }>>('connection_test', { conn }))
    },
    db: {
      listDatabases: (connectionId: string) =>
        wrap(() => invoke<IPCResult<string[]>>('db_list_databases', { connectionId })),
      getDatabaseInfo: (connectionId: string, database: string) =>
        wrap(() =>
          invoke<IPCResult<DatabaseInfo>>('db_get_database_info', { connectionId, database })
        ),
      listTables: (connectionId: string, database: string) =>
        wrap(() => invoke<IPCResult<string[]>>('db_list_tables', { connectionId, database })),
      queryRows: (req: QueryRowsRequest) =>
        wrap(() => invoke<IPCResult<QueryRowsResult>>('db_query_rows', { req })),
      insertRow: (req: InsertRowRequest) => wrap(() => invoke<IPCResult>('db_insert_row', { req })),
      updateRow: (req: UpdateRowRequest) => wrap(() => invoke<IPCResult>('db_update_row', { req })),
      deleteRows: (req: DeleteRowsRequest) =>
        wrap(() => invoke<IPCResult>('db_delete_rows', { req })),
      executeSQL: (connectionId: string, sql: string, database?: string) =>
        wrap(() => invoke<IPCResult>('db_execute_sql', { connectionId, sql, database })),
      explainSQL: (req: ExplainSQLRequest) =>
        wrap(() => invoke<IPCResult<ExplainSQLResult>>('db_explain_sql', { req })),
      renameTable: (req: RenameTableRequest) =>
        wrap(() => invoke<IPCResult<{ table: string }>>('db_rename_table', { req })),
      copyTable: (req: CopyTableRequest) =>
        wrap(() => invoke<IPCResult<{ table: string }>>('db_copy_table', { req })),
      dropDatabase: (req: DropDatabaseRequest) =>
        wrap(() => invoke<IPCResult<void>>('db_drop_database', { req })),
      dropTable: (req: DropTableRequest) =>
        wrap(() => invoke<IPCResult<void>>('db_drop_table', { req })),
      truncateTable: (req: TruncateTableRequest) =>
        wrap(() => invoke<IPCResult<void>>('db_truncate_table', { req })),
      exportTable: async (req: ExportTableRequest) => {
        const filePath = await save({
          defaultPath: `${req.table}.${req.format}`
        })
        if (!filePath) {
          return { ok: true, data: { canceled: true, rowsExported: 0 } as ExportTableResult }
        }
        return wrap(() =>
          invoke<IPCResult<ExportTableResult>>('db_export_table', { req, filePath })
        )
      },
      exportDatabase: async (req: ExportDatabaseRequest) => {
        const filePath = await save({
          defaultPath: `${req.database}.sql`
        })
        if (!filePath) {
          return {
            ok: true,
            data: { canceled: true, tablesExported: 0, rowsExported: 0 } as ExportDatabaseResult
          }
        }
        return wrap(() =>
          invoke<IPCResult<ExportDatabaseResult>>('db_export_database', { req, filePath })
        )
      },
      importTable: async (req: ImportTableRequest) => {
        if (req.fileContent) {
          return wrap(() => invoke<IPCResult<ImportTableResult>>('db_import_table', { req }))
        }
        const paths = await pickLocalPaths({ multiple: false })
        if (paths.length === 0) {
          return { ok: true, data: { canceled: true, rowsImported: 0, statementsExecuted: 0 } }
        }
        return wrap(() =>
          invoke<IPCResult<ImportTableResult>>('db_import_table', {
            req: { ...req, fileName: paths[0] },
            filePath: paths[0]
          })
        )
      }
    },
    schema: {
      getTable: (connectionId: string, database: string, table: string) =>
        wrap(() =>
          invoke<IPCResult<TableSchema>>('schema_get_table', { connectionId, database, table })
        )
    },
    ssh: {
      listFiles: (req: SSHListFilesRequest) =>
        wrap(() => invoke<IPCResult<SSHListFilesResult>>('ssh_list_files', { req })),
      uploadFile: async (req: SSHUploadFileRequest) => {
        const paths = await pickLocalPaths({ multiple: false })
        if (paths.length === 0) {
          return { ok: true, data: { canceled: true } as SSHFileOperationResult }
        }
        return wrap(() =>
          invoke<IPCResult<SSHFileOperationResult>>('ssh_upload_file', {
            req,
            localPath: paths[0]
          })
        )
      },
      uploadDirectory: async (req: SSHUploadDirectoryRequest) => {
        const paths = await pickLocalPaths({ directory: true })
        if (paths.length === 0) {
          return { ok: true, data: { canceled: true } as SSHFileOperationResult }
        }
        return wrap(() =>
          invoke<IPCResult<SSHFileOperationResult>>('ssh_upload_directory', {
            req,
            localPath: paths[0]
          })
        )
      },
      uploadEntries: (req: SSHUploadEntriesRequest) =>
        wrap(() => invoke<IPCResult<SSHFileOperationResult>>('ssh_upload_entries', { req })),
      downloadFile: async (req: SSHDownloadFileRequest) => {
        const filePath = await save({
          defaultPath: req.remotePath.split('/').pop() || 'download'
        })
        if (!filePath) {
          return { ok: true, data: { canceled: true } as SSHFileOperationResult }
        }
        return wrap(() =>
          invoke<IPCResult<SSHFileOperationResult>>('ssh_download_file', { req, localPath: filePath })
        )
      },
      downloadDirectory: async (req: SSHDownloadDirectoryRequest) => {
        const paths = await pickLocalPaths({ directory: true })
        if (paths.length === 0) {
          return { ok: true, data: { canceled: true } as SSHFileOperationResult }
        }
        return wrap(() =>
          invoke<IPCResult<SSHFileOperationResult>>('ssh_download_directory', {
            req,
            localPath: paths[0]
          })
        )
      },
      readFile: (req: SSHReadFileRequest) =>
        wrap(() => invoke<IPCResult<SSHReadFileResult>>('ssh_read_file', { req })),
      writeFile: (req: SSHWriteFileRequest) =>
        wrap(() => invoke<IPCResult<SSHFileOperationResult>>('ssh_write_file', { req })),
      createDirectory: (req: SSHCreateDirectoryRequest) =>
        wrap(() => invoke<IPCResult<SSHFileOperationResult>>('ssh_create_directory', { req })),
      deleteFile: (req: SSHDeleteFileRequest) =>
        wrap(() => invoke<IPCResult<SSHFileOperationResult>>('ssh_delete_file', { req })),
      moveFile: (req: SSHMoveFileRequest) =>
        wrap(() => invoke<IPCResult<SSHFileOperationResult>>('ssh_move_file', { req })),
      createTerminal: (req: SSHTerminalCreateRequest) =>
        wrap(() => invoke<IPCResult<SSHTerminalCreateResult>>('ssh_terminal_create', { req })),
      writeTerminal: (req: SSHTerminalWriteRequest) =>
        wrap(() => invoke<IPCResult<void>>('ssh_terminal_write', { req })),
      resizeTerminal: (req: SSHTerminalResizeRequest) =>
        wrap(() => invoke<IPCResult<void>>('ssh_terminal_resize', { req })),
      closeTerminal: (req: SSHTerminalCloseRequest) =>
        wrap(() => invoke<IPCResult<void>>('ssh_terminal_close', { req })),
      onTerminalData: (cb: (event: SSHTerminalDataEvent) => void) =>
        subscribe('ssh-terminal:data', cb),
      onTerminalExit: (cb: (event: SSHTerminalExitEvent) => void) =>
        subscribe('ssh-terminal:exit', cb)
    },
    system: {
      getPathForFile: (file: File) => {
        const anyFile = file as File & { path?: string }
        return anyFile.path || ''
      }
    },
    diff: {
      databases: (req: DiffRequest) =>
        wrap(() => invoke<IPCResult<DatabaseDiff>>('diff_databases', { req })),
      table: (req: TableDiffRequest) =>
        wrap(() => invoke<IPCResult<TableComparisonResult>>('diff_table', { req }))
    },
    sync: {
      buildPlan: (req: SyncRequest) =>
        wrap(() => invoke<IPCResult<SyncPlan>>('sync_build_plan', { req })),
      execute: (req: SyncRequest) =>
        wrap(() =>
          invoke<IPCResult<{ executed: number; errors: number }>>('sync_execute', { req })
        ),
      onProgress: (cb: (event: SyncProgressEvent) => void) => subscribe('sync:progress', cb)
    }
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
