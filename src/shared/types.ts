// 跨进程共享的所有类型定义。renderer / preload / main 都从这里导入，保证类型一致。

// ---------- 连接 ----------
export type SqlDbEngine = 'mysql' | 'postgres'
export type DbEngine = SqlDbEngine | 'redis'

export interface ConnectionConfig {
  id: string
  engine: DbEngine
  name: string
  group?: string
  host: string
  port: number
  username: string
  /** 仅在写入时携带；读取时不会回传明文，渲染端只能拿到 hasPassword 标记 */
  password?: string
  database?: string
  // SSH Tunnel
  useSSH: boolean
  sshHost?: string
  sshPort?: number
  sshUsername?: string
  sshPassword?: string
  sshPrivateKey?: string
  sshPassphrase?: string
  createdAt: number
  updatedAt: number
}

/** 渲染端能看到的安全版本：去除明文密码，附带 hasPassword 标记 */
export type SafeConnection = Omit<
  ConnectionConfig,
  'password' | 'sshPassword' | 'sshPrivateKey' | 'sshPassphrase'
> & {
  hasPassword: boolean
  hasSSHPassword: boolean
  hasSSHPrivateKey: boolean
}

// ---------- 表 / 字段 ----------
export interface ColumnInfo {
  name: string
  type: string                // 原始 column type, e.g. varchar(255) / integer
  nullable: boolean
  defaultValue: string | null
  isPrimaryKey: boolean
  isAutoIncrement: boolean    // MySQL: AUTO_INCREMENT；PG: DEFAULT nextval(...) / IDENTITY
  comment: string
  /** MySQL COLUMN_KEY: PRI/UNI/MUL/''；PG 用 PRI/UNI/'' */
  columnKey: string
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  type: string                // BTREE / HASH / FULLTEXT
}

export interface TableSchema {
  name: string
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  primaryKey: string[]
  createSQL: string
  rowEstimate?: number
  engine?: string
  charset?: string
  tableComment?: string
  dataLength?: number
  indexLength?: number
  dataFree?: number
  avgRowLength?: number
  autoIncrement?: number | null
  createdAt?: string | null
  updatedAt?: string | null
}

export interface DatabaseInfo {
  name: string
  tableCount: number
  rowEstimate?: number
  dataLength?: number
  indexLength?: number
  totalSize?: number
  dataFree?: number
  charset?: string
  collation?: string
  owner?: string
  comment?: string
}

// ---------- 行查询 ----------
export interface QueryRowsRequest {
  connectionId: string
  database: string
  table: string
  page: number                // 1-based
  pageSize: number
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
  where?: string              // 简单 where 片段（不含 'WHERE'）
}

export interface QueryRowsResult {
  rows: Record<string, unknown>[]
  total: number
  hasPrimaryKey: boolean
  primaryKey: string[]
  columns: ColumnInfo[]
}

// ---------- 行写入 ----------
export interface InsertRowRequest {
  connectionId: string
  database: string
  table: string
  values: Record<string, unknown>
}

export interface UpdateRowRequest {
  connectionId: string
  database: string
  table: string
  /** 主键字段 → 旧值 */
  pkValues: Record<string, unknown>
  /** 待更新字段 → 新值 */
  changes: Record<string, unknown>
}

export interface DeleteRowsRequest {
  connectionId: string
  database: string
  table: string
  /** 每一行的主键键值对 */
  pkRows: Record<string, unknown>[]
}

// ---------- 表操作 ----------
export interface RenameTableRequest {
  connectionId: string
  database: string
  table: string
  newTable: string
}

export interface CopyTableRequest {
  connectionId: string
  database: string
  table: string
  targetTable: string
}

export interface DropTableRequest {
  connectionId: string
  database: string
  table: string
}

export interface DropDatabaseRequest {
  connectionId: string
  database: string
}

export interface TruncateTableRequest {
  connectionId: string
  database: string
  table: string
}

export type ExportFormat = 'sql' | 'csv' | 'txt'

export type ExportScope = 'all' | 'filtered' | 'page' | 'selected'

export type ExportSqlDialect = 'source' | SqlDbEngine

export type ExportDatabaseBackend = 'builtin' | 'mysqldump' | 'mysqldump-ssh'

export type ImportFormat = ExportFormat

export interface ExportTableRequest {
  connectionId: string
  database: string
  table: string
  format: ExportFormat
  sqlDialect?: ExportSqlDialect
  scope: ExportScope
  where?: string
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
  page?: number
  pageSize?: number
  selectedRows?: Record<string, unknown>[]
  includeCreateTable?: boolean
  includeData?: boolean
  includeHeaders?: boolean
}

export interface ExportTableResult {
  canceled: boolean
  filePath?: string
  rowsExported: number
}

export interface ExportDatabaseRequest {
  connectionId: string
  database: string
  format: 'sql'
  sqlDialect?: ExportSqlDialect
  backend?: ExportDatabaseBackend
  includeCreateTable?: boolean
  includeData?: boolean
}

export interface ExportDatabaseResult {
  canceled: boolean
  filePath?: string
  tablesExported: number
  rowsExported: number
  backend?: ExportDatabaseBackend
  rowsCountAccurate?: boolean
}

export interface ImportTableRequest {
  connectionId: string
  database: string
  table: string
  format: ImportFormat
  includeHeaders?: boolean
  emptyAsNull?: boolean
  fileName?: string
  fileContent?: string
}

export interface ImportTableResult {
  canceled: boolean
  filePath?: string
  rowsImported: number
  statementsExecuted: number
}

// ---------- EXPLAIN ----------
export interface ExplainPlanMetric {
  label: string
  value: string | number
}

export interface ExplainPlanNode {
  id: string
  label: string
  detail?: string
  metrics: ExplainPlanMetric[]
  children: ExplainPlanNode[]
}

export interface ExplainSQLRequest {
  connectionId: string
  database?: string
  sql: string
}

export interface ExplainSQLResult {
  engine: SqlDbEngine
  statement: string
  summary: ExplainPlanMetric[]
  plan: ExplainPlanNode | null
  columns: string[]
  rows: Record<string, unknown>[]
  raw?: unknown
}

// ---------- SSH 文件管理 ----------
export type SSHFileEntryType = 'file' | 'directory' | 'symlink' | 'other'

export interface SSHFileEntry {
  name: string
  path: string
  type: SSHFileEntryType
  size: number
  modifiedAt: number | null
  permissions: string
}

export interface SSHTerminalCreateRequest {
  connectionId: string
  cols?: number
  rows?: number
}

export interface SSHTerminalCreateResult {
  sessionId: string
}

export interface SSHTerminalWriteRequest {
  sessionId: string
  data: string
}

export interface SSHTerminalResizeRequest {
  sessionId: string
  cols: number
  rows: number
}

export interface SSHTerminalCloseRequest {
  sessionId: string
}

export interface SSHTerminalDataEvent {
  sessionId: string
  data: string
}

export interface SSHTerminalExitEvent {
  sessionId: string
  message?: string
}

export interface SSHListFilesRequest {
  connectionId: string
  path?: string
}

export interface SSHListFilesResult {
  path: string
  parentPath: string | null
  entries: SSHFileEntry[]
}

export interface SSHUploadFileRequest {
  connectionId: string
  remoteDir: string
}

export interface SSHUploadDirectoryRequest {
  connectionId: string
  remoteDir: string
}

export type SSHUploadEntryType = 'file' | 'directory'

export type SSHUploadEntry =
  | { type: 'file'; localPath: string; relativePath: string }
  | { type: 'directory'; relativePath: string }

export interface SSHUploadEntriesRequest {
  connectionId: string
  remoteDir: string
  entries: SSHUploadEntry[]
}

export interface SSHDownloadFileRequest {
  connectionId: string
  remotePath: string
}

export interface SSHDownloadDirectoryRequest {
  connectionId: string
  remotePath: string
}

export interface SSHReadFileRequest {
  connectionId: string
  remotePath: string
}

export interface SSHReadFileResult {
  path: string
  content: string
}

export interface SSHWriteFileRequest {
  connectionId: string
  remotePath: string
  content: string
}

export interface SSHCreateDirectoryRequest {
  connectionId: string
  remoteDir: string
  name: string
}

export interface SSHDeleteFileRequest {
  connectionId: string
  remotePath: string
  type: SSHFileEntryType
}

export interface SSHMoveFileRequest {
  connectionId: string
  remotePath: string
  nextPath: string
}

export interface SSHFileOperationResult {
  canceled: boolean
  localPath?: string
  remotePath?: string
}

// ---------- Diff ----------
export type DiffKind = 'only-in-source' | 'only-in-target' | 'modified'

export interface ColumnDiff {
  name: string
  kind: DiffKind
  source?: ColumnInfo
  target?: ColumnInfo
}

export interface IndexDiff {
  name: string
  kind: DiffKind
  source?: IndexInfo
  target?: IndexInfo
}

export interface TableDataDiffSample {
  kind: DiffKind
  key: string
  source?: Record<string, unknown>
  target?: Record<string, unknown>
}

export interface TableDataDiff {
  comparable: boolean
  reason?: string
  keyColumns: string[]
  compareColumns: string[]
  sourceRowCount: number
  targetRowCount: number
  sourceOnly: number
  targetOnly: number
  modified: number
  identical: number
  samples: TableDataDiffSample[]
}

export interface TableDiff {
  table: string
  kind: DiffKind
  columnDiffs: ColumnDiff[]
  indexDiffs: IndexDiff[]
  dataDiff?: TableDataDiff
}

export interface TableRowComparison {
  table: string
  dataDiff: TableDataDiff
}

export interface DatabaseDiff {
  sourceDatabase: string
  targetDatabase: string
  tableDiffs: TableDiff[]
  rowComparisons: TableRowComparison[]
}

export interface DiffRequest {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  includeData?: boolean
  tables?: string[]
}

export interface TableDiffRequest {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  table: string
  includeData?: boolean
}

export interface TableComparisonResult {
  tableDiff: TableDiff | null
  rowComparison: TableRowComparison | null
}

// ---------- Sync ----------
export type ExistingTableStrategy = 'skip' | 'overwrite-structure' | 'append-data' | 'truncate-and-import'

export interface SyncRequest {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  /** 选中的表 */
  tables: string[]
  /** 同步内容 */
  syncStructure: boolean
  syncData: boolean
  existingTableStrategy: ExistingTableStrategy
  /** dry-run: 只生成 SQL 不执行 */
  dryRun: boolean
}

export interface SyncPlan {
  /** 顺序执行的 SQL 列表，按表分组 */
  steps: SyncStep[]
}

export interface SyncStep {
  table: string
  description: string
  sqls: string[]
}

export interface SyncProgressEvent {
  table: string
  step: string
  done: number
  total: number
  message?: string
  level: 'info' | 'warn' | 'error'
}

// ---------- 通用结果 ----------
export interface IPCResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}
