// 集中管理 IPC channel 名，避免拼写错误。
export const IPC = {
  // 连接 CRUD
  ConnectionList: 'connection:list',
  ConnectionUpsert: 'connection:upsert',
  ConnectionDelete: 'connection:delete',
  ConnectionClose: 'connection:close',
  ConnectionSetDatabaseCredential: 'connection:setDatabaseCredential',
  ConnectionTestDatabaseCredential: 'connection:testDatabaseCredential',
  ConnectionTest: 'connection:test',

  // 数据库浏览（引擎无关）
  ListDatabases: 'db:listDatabases',
  GetDatabaseInfo: 'db:getDatabaseInfo',
  ListTables: 'db:listTables',
  QueryRows: 'db:queryRows',
  InsertRow: 'db:insertRow',
  UpdateRow: 'db:updateRow',
  DeleteRows: 'db:deleteRows',
  ExecuteSQL: 'db:executeSQL',
  ExplainSQL: 'db:explainSQL',
  RenameTable: 'db:renameTable',
  CopyTable: 'db:copyTable',
  DropDatabase: 'db:dropDatabase',
  DropTable: 'db:dropTable',
  TruncateTable: 'db:truncateTable',
  ExportTable: 'db:exportTable',
  ExportDatabase: 'db:exportDatabase',
  ImportTable: 'db:importTable',

  // 表结构
  GetTableSchema: 'schema:getTable',

  // SSH 文件管理
  SSHListFiles: 'ssh:listFiles',
  SSHUploadFile: 'ssh:uploadFile',
  SSHUploadDirectory: 'ssh:uploadDirectory',
  SSHUploadEntries: 'ssh:uploadEntries',
  SSHDownloadFile: 'ssh:downloadFile',
  SSHDownloadDirectory: 'ssh:downloadDirectory',
  SSHReadFile: 'ssh:readFile',
  SSHWriteFile: 'ssh:writeFile',
  SSHCreateDirectory: 'ssh:createDirectory',
  SSHDeleteFile: 'ssh:deleteFile',
  SSHMoveFile: 'ssh:moveFile',
  SSHTerminalCreate: 'ssh-terminal:create',
  SSHTerminalWrite: 'ssh-terminal:write',
  SSHTerminalResize: 'ssh-terminal:resize',
  SSHTerminalClose: 'ssh-terminal:close',
  SSHTerminalData: 'ssh-terminal:data',
  SSHTerminalExit: 'ssh-terminal:exit',

  // Diff & Sync
  DiffDatabases: 'diff:databases',
  DiffTable: 'diff:table',
  BuildSyncPlan: 'sync:buildPlan',
  ExecuteSync: 'sync:execute',

  // 事件 (main → renderer)
  SyncProgress: 'sync:progress'
} as const

export type IPCChannel = (typeof IPC)[keyof typeof IPC]
