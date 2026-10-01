import type {
  ConnectionConfig,
  ConnectionOrganizationItem,
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
} from './types'

export interface TrustedHostKey { host: string; port: number; fingerprint: string }

export interface AppRuntimeInfo {
  readonly mode: 'electron' | 'web' | 'tauri'
  readonly supportsNativeFilePicker: boolean
  readonly supportsDirectoryUpload: boolean
  readonly supportsTerminalStreaming: boolean
  readonly supportsDownload: boolean
}

export interface AppAPI {
  readonly runtime: AppRuntimeInfo
  readonly operations: { cancel: (operationId: string) => Promise<IPCResult<void>> }
  readonly connection: {
    list: () => Promise<IPCResult<SafeConnection[]>>
    organize: (items: ConnectionOrganizationItem[]) => Promise<IPCResult<SafeConnection[]>>
    updateDatabaseBrowsing: (id: string, options: { database?: string; showAll?: boolean; credential?: DatabaseCredentialConfig }) => Promise<IPCResult<SafeConnection>>
    upsert: (conn: ConnectionConfig) => Promise<IPCResult<SafeConnection>>
    remove: (id: string) => Promise<IPCResult<void>>
    close: (id: string) => Promise<IPCResult<void>>
    setDatabaseCredential: (
      id: string,
      database: string,
      credential: DatabaseCredentialConfig
    ) => Promise<IPCResult<SafeConnection>>
    testDatabaseCredential: (
      id: string,
      database: string,
      credential: DatabaseCredentialConfig
    ) => Promise<IPCResult<{ message: string }>>
    test: (conn: ConnectionConfig) => Promise<IPCResult<{ message: string }>>
  }
  readonly db: {
    listDatabases: (connectionId: string) => Promise<IPCResult<string[]>>
    discoverDatabases: (connectionId: string) => Promise<IPCResult<string[]>>
    listSchemas: (connectionId: string, database: string) => Promise<IPCResult<string[]>>
    getDatabaseInfo: (connectionId: string, database: string) => Promise<IPCResult<DatabaseInfo>>
    listTables: (connectionId: string, database: string, schema?: string) => Promise<IPCResult<string[]>>
    scanRedisKeys: (connectionId: string, database: string, cursor?: string, pattern?: string, operationId?: string) => Promise<IPCResult<{ keys: string[]; nextCursor: string; complete: boolean }>>
    queryRows: (req: QueryRowsRequest, operationId?: string) => Promise<IPCResult<QueryRowsResult>>
    insertRow: (req: InsertRowRequest) => Promise<IPCResult>
    updateRow: (req: UpdateRowRequest) => Promise<IPCResult>
    deleteRows: (req: DeleteRowsRequest) => Promise<IPCResult>
    executeSQL: (connectionId: string, sql: string, database?: string, operationId?: string) => Promise<IPCResult>
    explainSQL: (req: ExplainSQLRequest, operationId?: string) => Promise<IPCResult<ExplainSQLResult>>
    renameTable: (req: RenameTableRequest) => Promise<IPCResult<{ table: string }>>
    copyTable: (req: CopyTableRequest) => Promise<IPCResult<{ table: string }>>
    dropDatabase: (req: DropDatabaseRequest) => Promise<IPCResult<void>>
    dropTable: (req: DropTableRequest) => Promise<IPCResult<void>>
    truncateTable: (req: TruncateTableRequest) => Promise<IPCResult<void>>
    exportTable: (req: ExportTableRequest, operationId?: string) => Promise<IPCResult<ExportTableResult>>
    exportDatabase: (req: ExportDatabaseRequest, operationId?: string) => Promise<IPCResult<ExportDatabaseResult>>
    importTable: (req: ImportTableRequest, operationId?: string) => Promise<IPCResult<ImportTableResult>>
  }
  readonly schema: {
    getTable: (connectionId: string, database: string, table: string) => Promise<IPCResult<TableSchema>>
  }
  readonly ssh: {
    listHostKeys: () => Promise<IPCResult<TrustedHostKey[]>>
    forgetHostKey: (host: string, port: number, fingerprint: string) => Promise<IPCResult<boolean>>
    listFiles: (req: SSHListFilesRequest) => Promise<IPCResult<SSHListFilesResult>>
    uploadFile: (req: SSHUploadFileRequest) => Promise<IPCResult<SSHFileOperationResult>>
    uploadDirectory: (req: SSHUploadDirectoryRequest) => Promise<IPCResult<SSHFileOperationResult>>
    uploadEntries: (req: SSHUploadEntriesRequest) => Promise<IPCResult<SSHFileOperationResult>>
    downloadFile: (req: SSHDownloadFileRequest) => Promise<IPCResult<SSHFileOperationResult>>
    downloadDirectory: (req: SSHDownloadDirectoryRequest) => Promise<IPCResult<SSHFileOperationResult>>
    readFile: (req: SSHReadFileRequest) => Promise<IPCResult<SSHReadFileResult>>
    writeFile: (req: SSHWriteFileRequest) => Promise<IPCResult<SSHFileOperationResult>>
    createDirectory: (req: SSHCreateDirectoryRequest) => Promise<IPCResult<SSHFileOperationResult>>
    deleteFile: (req: SSHDeleteFileRequest) => Promise<IPCResult<SSHFileOperationResult>>
    moveFile: (req: SSHMoveFileRequest) => Promise<IPCResult<SSHFileOperationResult>>
    createTerminal: (req: SSHTerminalCreateRequest) => Promise<IPCResult<SSHTerminalCreateResult>>
    writeTerminal: (req: SSHTerminalWriteRequest) => Promise<IPCResult<void>>
    resizeTerminal: (req: SSHTerminalResizeRequest) => Promise<IPCResult<void>>
    closeTerminal: (req: SSHTerminalCloseRequest) => Promise<IPCResult<void>>
    onTerminalData: (cb: (event: SSHTerminalDataEvent) => void) => () => void
    onTerminalExit: (cb: (event: SSHTerminalExitEvent) => void) => () => void
  }
  readonly system: {
    getPathForFile: (file: File) => string
  }
  readonly diff: {
    databases: (req: DiffRequest, operationId?: string) => Promise<IPCResult<DatabaseDiff>>
    table: (req: TableDiffRequest, operationId?: string) => Promise<IPCResult<TableComparisonResult>>
  }
  readonly sync: {
    buildPlan: (req: SyncRequest, operationId?: string) => Promise<IPCResult<SyncPlan>>
    execute: (req: SyncRequest, operationId?: string) => Promise<IPCResult<{ executed: number; errors: number }>>
    onProgress: (cb: (event: SyncProgressEvent) => void) => () => void
  }
}
