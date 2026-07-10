// Preload：唯一允许调用 ipcRenderer 的地方。通过 contextBridge 把强类型 API 暴露给 renderer。
import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { AppAPI } from '../shared/app-api'
import type {
  ConnectionConfig,
  CopyTableRequest,
  DatabaseCredentialConfig,
  DatabaseInfo,
  DatabaseDiff,
  DiffRequest,
  DeleteRowsRequest,
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
  SSHTerminalCloseRequest,
  SSHTerminalCreateRequest,
  SSHTerminalCreateResult,
  SSHTerminalDataEvent,
  SSHTerminalExitEvent,
  SSHTerminalResizeRequest,
  SSHTerminalWriteRequest,
  SSHReadFileRequest,
  SSHReadFileResult,
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
} from '../shared/types'

const invoke = <T,>(channel: string, payload?: unknown): Promise<IPCResult<T>> =>
  ipcRenderer.invoke(channel, payload)

const api = {
  runtime: {
    mode: 'electron',
    supportsNativeFilePicker: true,
    supportsDirectoryUpload: true,
    supportsTerminalStreaming: true,
    supportsDownload: true
  },
  connection: {
    list: () => invoke<SafeConnection[]>(IPC.ConnectionList),
    upsert: (conn: ConnectionConfig) => invoke<SafeConnection>(IPC.ConnectionUpsert, conn),
    remove: (id: string) => invoke<void>(IPC.ConnectionDelete, id),
    close: (id: string) => invoke<void>(IPC.ConnectionClose, id),
    setDatabaseCredential: (id: string, database: string, credential: DatabaseCredentialConfig) =>
      invoke<SafeConnection>(IPC.ConnectionSetDatabaseCredential, { id, database, credential }),
    testDatabaseCredential: (id: string, database: string, credential: DatabaseCredentialConfig) =>
      invoke<{ message: string }>(IPC.ConnectionTestDatabaseCredential, { id, database, credential }),
    test: (conn: ConnectionConfig) => invoke<{ message: string }>(IPC.ConnectionTest, conn)
  },
  db: {
    listDatabases: (connectionId: string) =>
      invoke<string[]>(IPC.ListDatabases, { connectionId }),
    getDatabaseInfo: (connectionId: string, database: string) =>
      invoke<DatabaseInfo>(IPC.GetDatabaseInfo, { connectionId, database }),
    listTables: (connectionId: string, database: string) =>
      invoke<string[]>(IPC.ListTables, { connectionId, database }),
    queryRows: (req: QueryRowsRequest) => invoke<QueryRowsResult>(IPC.QueryRows, req),
    insertRow: (req: InsertRowRequest) => invoke(IPC.InsertRow, req),
    updateRow: (req: UpdateRowRequest) => invoke(IPC.UpdateRow, req),
    deleteRows: (req: DeleteRowsRequest) => invoke(IPC.DeleteRows, req),
    executeSQL: (connectionId: string, sql: string, database?: string) =>
      invoke(IPC.ExecuteSQL, { connectionId, sql, database }),
    explainSQL: (req: ExplainSQLRequest) => invoke<ExplainSQLResult>(IPC.ExplainSQL, req),
    renameTable: (req: RenameTableRequest) => invoke<{ table: string }>(IPC.RenameTable, req),
    copyTable: (req: CopyTableRequest) => invoke<{ table: string }>(IPC.CopyTable, req),
    dropDatabase: (req: DropDatabaseRequest) => invoke<void>(IPC.DropDatabase, req),
    dropTable: (req: DropTableRequest) => invoke<void>(IPC.DropTable, req),
    truncateTable: (req: TruncateTableRequest) => invoke<void>(IPC.TruncateTable, req),
    exportTable: (req: ExportTableRequest) => invoke<ExportTableResult>(IPC.ExportTable, req),
    exportDatabase: (req: ExportDatabaseRequest) => invoke<ExportDatabaseResult>(IPC.ExportDatabase, req),
    importTable: (req: ImportTableRequest) => invoke<ImportTableResult>(IPC.ImportTable, req)
  },
  schema: {
    getTable: (connectionId: string, database: string, table: string) =>
      invoke<TableSchema>(IPC.GetTableSchema, { connectionId, database, table })
  },
  ssh: {
    listFiles: (req: SSHListFilesRequest) => invoke<SSHListFilesResult>(IPC.SSHListFiles, req),
    uploadFile: (req: SSHUploadFileRequest) => invoke<SSHFileOperationResult>(IPC.SSHUploadFile, req),
    uploadDirectory: (req: SSHUploadDirectoryRequest) => invoke<SSHFileOperationResult>(IPC.SSHUploadDirectory, req),
    uploadEntries: (req: SSHUploadEntriesRequest) => invoke<SSHFileOperationResult>(IPC.SSHUploadEntries, req),
    downloadFile: (req: SSHDownloadFileRequest) => invoke<SSHFileOperationResult>(IPC.SSHDownloadFile, req),
    downloadDirectory: (req: SSHDownloadDirectoryRequest) => invoke<SSHFileOperationResult>(IPC.SSHDownloadDirectory, req),
    readFile: (req: SSHReadFileRequest) => invoke<SSHReadFileResult>(IPC.SSHReadFile, req),
    writeFile: (req: SSHWriteFileRequest) => invoke<SSHFileOperationResult>(IPC.SSHWriteFile, req),
    createDirectory: (req: SSHCreateDirectoryRequest) => invoke<SSHFileOperationResult>(IPC.SSHCreateDirectory, req),
    deleteFile: (req: SSHDeleteFileRequest) => invoke<SSHFileOperationResult>(IPC.SSHDeleteFile, req),
    moveFile: (req: SSHMoveFileRequest) => invoke<SSHFileOperationResult>(IPC.SSHMoveFile, req),
    createTerminal: (req: SSHTerminalCreateRequest) => invoke<SSHTerminalCreateResult>(IPC.SSHTerminalCreate, req),
    writeTerminal: (req: SSHTerminalWriteRequest) => invoke<void>(IPC.SSHTerminalWrite, req),
    resizeTerminal: (req: SSHTerminalResizeRequest) => invoke<void>(IPC.SSHTerminalResize, req),
    closeTerminal: (req: SSHTerminalCloseRequest) => invoke<void>(IPC.SSHTerminalClose, req),
    onTerminalData: (cb: (event: SSHTerminalDataEvent) => void) => {
      const listener = (_: IpcRendererEvent, event: SSHTerminalDataEvent) => cb(event)
      ipcRenderer.on(IPC.SSHTerminalData, listener)
      return () => {
        ipcRenderer.off(IPC.SSHTerminalData, listener)
      }
    },
    onTerminalExit: (cb: (event: SSHTerminalExitEvent) => void) => {
      const listener = (_: IpcRendererEvent, event: SSHTerminalExitEvent) => cb(event)
      ipcRenderer.on(IPC.SSHTerminalExit, listener)
      return () => {
        ipcRenderer.off(IPC.SSHTerminalExit, listener)
      }
    }
  },
  system: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file)
  },
  diff: {
    databases: (req: DiffRequest) => invoke<DatabaseDiff>(IPC.DiffDatabases, req),
    table: (req: TableDiffRequest) => invoke<TableComparisonResult>(IPC.DiffTable, req)
  },
  sync: {
    buildPlan: (req: SyncRequest) => invoke<SyncPlan>(IPC.BuildSyncPlan, req),
    execute: (req: SyncRequest) => invoke<{ executed: number; errors: number }>(IPC.ExecuteSync, req),
    onProgress: (cb: (e: SyncProgressEvent) => void) => {
      const listener = (_: IpcRendererEvent, e: SyncProgressEvent) => cb(e)
      ipcRenderer.on(IPC.SyncProgress, listener)
      return () => {
        ipcRenderer.off(IPC.SyncProgress, listener)
      }
    }
  }
} satisfies AppAPI

contextBridge.exposeInMainWorld('api', api)

export type { AppAPI }
