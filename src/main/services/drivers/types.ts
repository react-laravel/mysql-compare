// 数据库驱动抽象。每种引擎（MySQL / Postgres）实现 DbDriver，
// 所有上层 service 只与该接口交互，不再直接使用 mysql2 / pg。
import type {
  ColumnInfo,
  ConnectionConfig,
  CopyTableRequest,
  DatabaseInfo,
  DbEngine,
  DeleteRowsRequest,
  DropDatabaseRequest,
  DropTableRequest,
  ExplainSQLResult,
  InsertRowRequest,
  QueryRowsRequest,
  RenameTableRequest,
  TableSchema,
  UpdateRowRequest
} from '../../../shared/types'

/** SQL 方言：纯函数集合，不做 I/O。driver 持有自己的 dialect 实例。 */
export interface Dialect {
  readonly engine: DbEngine
  quoteIdent(name: string): string
  quoteTable(database: string, table: string): string
  /** 把 JS 值转为引擎能接受的 SQL 字面量，仅用于内部生成脚本 */
  formatLiteral(value: unknown): string
  renderInsert(
    database: string,
    table: string,
    columns: ColumnInfo[],
    rows: Record<string, unknown>[]
  ): string
  renderTruncate(database: string, table: string): string
  renderDropIfExists(database: string, table: string): string
  /** 对 MySQL，清理 SHOW CREATE TABLE 里的 DEFINER；对其他引擎原样返回 */
  stripDefiner(sql: string): string
}

export interface StreamRowsOptions {
  database: string
  table: string
  /** 需要读取的列名（已按 schema 顺序） */
  columns: string[]
  /** 用于排序稳定性的主键（无主键时 driver 用全列排序） */
  primaryKey: string[]
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
  /** 可选 WHERE 片段，不带关键字 */
  where?: string
  batchSize: number
  /** 读取总行数上限；未指定则读取全部 */
  limit?: number
}

export interface DbDriver {
  readonly engine: DbEngine
  readonly connectionId: string
  readonly dialect: Dialect

  listDatabases(): Promise<string[]>
  getDatabaseInfo(database: string): Promise<DatabaseInfo>
  listTables(database: string): Promise<string[]>
  /** Optional: FK edges where fromTable references toTable. Missing => treated as no FKs. */
  listForeignKeyEdges?(database: string): Promise<Array<{ fromTable: string; toTable: string }>>
  getTableSchema(database: string, table: string): Promise<TableSchema>

  queryRows(
    req: QueryRowsRequest
  ): Promise<{ rows: Record<string, unknown>[]; total: number }>
  insertRow(
    req: InsertRowRequest
  ): Promise<{ insertId: number | string; affectedRows: number }>
  updateRow(req: UpdateRowRequest): Promise<{ affectedRows: number }>
  deleteRows(req: DeleteRowsRequest): Promise<{ affectedRows: number }>
  renameTable(req: RenameTableRequest): Promise<{ table: string }>
  copyTable(req: CopyTableRequest): Promise<{ table: string }>
  dropDatabase(req: DropDatabaseRequest): Promise<void>
  dropTable(req: DropTableRequest): Promise<void>
  executeSQL(sql: string, database?: string): Promise<unknown>
  explainSQL(sql: string, database?: string): Promise<ExplainSQLResult>

  streamRows(opts: StreamRowsOptions): AsyncIterable<Record<string, unknown>[]>

  /** 测试连接可用性，返回版本信息等短字符串 */
  testConnection(): Promise<string>

  close(): Promise<void>
}

/** 每种引擎注册一个 factory，接收解密后的 ConnectionConfig + 本地端口（SSH 时） */
export type DriverFactory = (params: {
  connection: ConnectionConfig
  /** 通过 SSH 隧道时的本地端口；否则为 undefined */
  localPort?: number
}) => DbDriver
