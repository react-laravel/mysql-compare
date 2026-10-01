import { describeBackendError } from './backend-error'
import { useI18nStore } from '@renderer/i18n'
import { tableDisplayName } from '../../shared/table-reference'
import { invoke as rawInvoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

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
    const result = await fn()
    return result.ok || !result.error ? result : { ...result, error: describeBackendError(result.error, useI18nStore.getState().locale === 'zh-CN') }
  } catch (error) {
    return {
      ok: false,
      error: describeBackendError(error instanceof Error ? error.message : String(error), useI18nStore.getState().locale === 'zh-CN')
    }
  }
}

function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | null = null
  let cancelled = false
  void listen<T>(event, (e) => {
    callback(e.payload)
  }).then((fn) => {
    // 若 cleanup 先于 listen 完成（StrictMode 下必现），立即注销避免泄漏。
    if (cancelled) {
      fn()
    } else {
      unlisten = fn
    }
  })
  return () => {
    cancelled = true
    unlisten?.()
  }
}

type FileSelection = { path: string; grantId: string }
async function pickFiles(purpose: string, defaultName?: string): Promise<FileSelection[]> {
  const result = await invoke<IPCResult<FileSelection[]>>('file_pick', { purpose, defaultName })
  if (!result.ok) throw new Error(result.error || 'Unable to select a local file')
  return result.data || []
}

// Backend requires native user confirmation; renderer code cannot silently trust a key.
const confirmations = new Map<string, Promise<IPCResult<boolean>>>()
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const result = await rawInvoke<T>(command, args)
  const error = (result as IPCResult)?.error
  if (!error?.startsWith('SSH_HOST_KEY_CHALLENGE:')) return result
  const challenge = JSON.parse(error.slice('SSH_HOST_KEY_CHALLENGE:'.length)) as { challengeId: string; fingerprint: string }
  let confirmation = confirmations.get(challenge.challengeId)
  if (!confirmation) {
    confirmation = rawInvoke<IPCResult<boolean>>('ssh_host_key_confirm', { challengeId: challenge.challengeId, fingerprint: challenge.fingerprint })
    confirmations.set(challenge.challengeId, confirmation)
  }
  try {
    const confirmed = await confirmation
    if (!confirmed.ok || !confirmed.data) return { ok: false, error: confirmed.error || 'SSH host key was not trusted. Verify the fingerprint and reconnect.' } as T
    return await rawInvoke<T>(command, args)
  } finally { confirmations.delete(challenge.challengeId) }
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
    operations: { cancel: (operationId) => wrap(() => invoke<IPCResult<void>>('operation_cancel', { operationId })) },
    connection: {
      list: () => wrap(() => invoke<IPCResult<SafeConnection[]>>('connection_list')),
      organize: (items) => wrap(() => invoke<IPCResult<SafeConnection[]>>('connection_organize', { items })),
      updateDatabaseBrowsing: (id, options) => wrap(() => invoke<IPCResult<SafeConnection>>('connection_update_database_browsing', { id, ...options })),
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
      discoverDatabases: (connectionId) => wrap(() => invoke<IPCResult<string[]>>('db_discover_databases', { connectionId })),
      listSchemas: (connectionId, database) => wrap(() => invoke<IPCResult<string[]>>('db_list_schemas', { connectionId, database })),
      listDatabases: (connectionId: string) =>
        wrap(() => invoke<IPCResult<string[]>>('db_list_databases', { connectionId })),
      getDatabaseInfo: (connectionId: string, database: string) =>
        wrap(() =>
          invoke<IPCResult<DatabaseInfo>>('db_get_database_info', { connectionId, database })
        ),
      listTables: (connectionId: string, database: string, schema?: string) =>
        wrap(() => invoke<IPCResult<string[]>>('db_list_tables', { connectionId, database, schema })),
      scanRedisKeys: (connectionId, database, cursor, pattern, operationId) =>
        wrap(() => invoke<IPCResult<{ keys: string[]; nextCursor: string; complete: boolean }>>('db_scan_redis_keys', { connectionId, database, cursor, pattern, operationId })),
      queryRows: (req: QueryRowsRequest, operationId?: string) =>
        wrap(() => invoke<IPCResult<QueryRowsResult>>('db_query_rows', { req, operationId })),
      insertRow: (req: InsertRowRequest) => wrap(() => invoke<IPCResult>('db_insert_row', { req })),
      updateRow: (req: UpdateRowRequest) => wrap(() => invoke<IPCResult>('db_update_row', { req })),
      deleteRows: (req: DeleteRowsRequest) =>
        wrap(() => invoke<IPCResult>('db_delete_rows', { req })),
      executeSQL: (connectionId: string, sql: string, database?: string, operationId?: string) =>
        wrap(() => invoke<IPCResult>('db_execute_sql', { connectionId, sql, database, operationId })),
      explainSQL: (req: ExplainSQLRequest, operationId?: string) =>
        wrap(() => invoke<IPCResult<ExplainSQLResult>>('db_explain_sql', { req, operationId })),
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
      exportTable: async (req: ExportTableRequest, operationId?: string) => {
        const [selected] = await pickFiles('export_table', `${tableDisplayName(req.table).replace(/[\\/]/g, '_')}.${req.format}`)
        const filePath = selected?.path
        if (!filePath) {
          return { ok: true, data: { canceled: true, rowsExported: 0 } as ExportTableResult }
        }
        return wrap(() =>
          invoke<IPCResult<ExportTableResult>>('db_export_table', { req, filePath, fileGrant: selected.grantId, operationId })
        )
      },
      exportDatabase: async (req: ExportDatabaseRequest, operationId?: string) => {
        const [selected] = await pickFiles('export_database', `${req.database.replace(/[\\/]/g, '_')}.sql`)
        const filePath = selected?.path
        if (!filePath) {
          return {
            ok: true,
            data: { canceled: true, tablesExported: 0, rowsExported: 0 } as ExportDatabaseResult
          }
        }
        return wrap(() =>
          invoke<IPCResult<ExportDatabaseResult>>('db_export_database', { req, filePath, fileGrant: selected.grantId, operationId })
        )
      },
      importTable: async (req: ImportTableRequest, operationId?: string) => {
        if (req.fileContent) {
          return wrap(() => invoke<IPCResult<ImportTableResult>>('db_import_table', { req, operationId }))
        }
        const selected = await pickFiles('import_table')
        if (selected.length === 0) {
          return { ok: true, data: { canceled: true, rowsImported: 0, statementsExecuted: 0 } }
        }
        return wrap(() =>
          invoke<IPCResult<ImportTableResult>>('db_import_table', {
            req: { ...req, fileName: selected[0]!.path },
            filePath: selected[0]!.path, fileGrant: selected[0]!.grantId, operationId
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
      listHostKeys: () => wrap(() => invoke<IPCResult<import('../../shared/app-api').TrustedHostKey[]>>('ssh_host_key_list')),
      forgetHostKey: (host, port, fingerprint) => wrap(() => invoke<IPCResult<boolean>>('ssh_host_key_forget', { host, port, fingerprint })),
      listFiles: (req: SSHListFilesRequest) =>
        wrap(() => invoke<IPCResult<SSHListFilesResult>>('ssh_list_files', { req })),
      uploadFile: async (req: SSHUploadFileRequest) => {
        const selected = await pickFiles('ssh_upload_file')
        if (selected.length === 0) {
          return { ok: true, data: { canceled: true } as SSHFileOperationResult }
        }
        return wrap(() =>
          invoke<IPCResult<SSHFileOperationResult>>('ssh_upload_file', {
            req,
            localPath: selected[0]!.path, fileGrant: selected[0]!.grantId
          })
        )
      },
      uploadDirectory: async (req: SSHUploadDirectoryRequest) => {
        const selected = await pickFiles('ssh_upload_directory')
        if (selected.length === 0) {
          return { ok: true, data: { canceled: true } as SSHFileOperationResult }
        }
        return wrap(() =>
          invoke<IPCResult<SSHFileOperationResult>>('ssh_upload_directory', {
            req,
            localPath: selected[0]!.path, fileGrant: selected[0]!.grantId
          })
        )
      },
      uploadEntries: async (req: SSHUploadEntriesRequest) => {
        const selected = await pickFiles('ssh_upload_entries')
        if (!selected.length) return { ok: true, data: { canceled: true } }
        return wrap(() => invoke<IPCResult<SSHFileOperationResult>>('ssh_upload_entries', {
          req: { ...req, entries: selected.map(({ path }) => ({ type: 'file', localPath: path, relativePath: path.split(/[\\/]/).pop() || 'upload' })) },
          fileGrants: selected.map(({ grantId }) => grantId)
        }))
      },
      downloadFile: async (req: SSHDownloadFileRequest) => {
        const [selected] = await pickFiles('ssh_download_file', req.remotePath.split('/').pop() || 'download')
        const filePath = selected?.path
        if (!filePath) {
          return { ok: true, data: { canceled: true } as SSHFileOperationResult }
        }
        return wrap(() =>
          invoke<IPCResult<SSHFileOperationResult>>('ssh_download_file', { req, localPath: filePath, fileGrant: selected.grantId })
        )
      },
      downloadDirectory: async (req: SSHDownloadDirectoryRequest) => {
        const selected = await pickFiles('ssh_download_directory')
        if (selected.length === 0) {
          return { ok: true, data: { canceled: true } as SSHFileOperationResult }
        }
        return wrap(() =>
          invoke<IPCResult<SSHFileOperationResult>>('ssh_download_directory', {
            req,
            localPath: selected[0]!.path, fileGrant: selected[0]!.grantId
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
      databases: (req: DiffRequest, operationId?: string) =>
        wrap(() => invoke<IPCResult<DatabaseDiff>>('diff_databases', { req, operationId })),
      table: (req: TableDiffRequest, operationId?: string) =>
        wrap(() => invoke<IPCResult<TableComparisonResult>>('diff_table', { req, operationId }))
    },
    sync: {
      buildPlan: (req: SyncRequest, operationId?: string) =>
        wrap(() => invoke<IPCResult<SyncPlan>>('sync_build_plan', { req, operationId })),
      execute: (req: SyncRequest, operationId?: string) =>
        wrap(() =>
          invoke<IPCResult<{ executed: number; errors: number }>>('sync_execute', { req, operationId })
        ),
      onProgress: (cb: (event: SyncProgressEvent) => void) => subscribe('sync:progress', cb)
    }
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
