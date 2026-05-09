// MySQL 驱动实现。一个实例对应一个 connectionId，按 database 维护 mysql2 Pool。
import mysql, { Connection, Pool, PoolOptions, RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import type {
  ColumnInfo,
  ConnectionConfig,
  CopyTableRequest,
  DatabaseInfo,
  DeleteRowsRequest,
  DropDatabaseRequest,
  DropTableRequest,
  ExplainSQLResult,
  IndexInfo,
  InsertRowRequest,
  QueryRowsRequest,
  RenameTableRequest,
  TableSchema,
  UpdateRowRequest
} from '../../../shared/types'
import type { DbDriver, Dialect, StreamRowsOptions } from './types'
import { buildMySQLOrderClause, mysqlDialect } from './mysql-dialect'
import { MySQLPoolCache, type MySQLDriverPoolDebugSnapshot } from './mysql-pool-cache'
import {
  buildMySQLExplainResult,
  buildPlainExplainResult,
  prepareExplainTarget
} from './explain-utils'

export type { MySQLDriverPoolDebugSnapshot } from './mysql-pool-cache'

const MAX_PAGE_SIZE = 1000
const SYSTEM_DATABASES = new Set(['information_schema', 'performance_schema', 'mysql', 'sys'])

export class MySQLDriver implements DbDriver {
  readonly engine = 'mysql' as const
  readonly dialect: Dialect = mysqlDialect
  readonly connectionId: string

  private readonly poolCache: MySQLPoolCache
  private readonly connection: ConnectionConfig
  private readonly localPort: number | undefined

  constructor(params: { connection: ConnectionConfig; localPort?: number }) {
    this.connection = params.connection
    this.localPort = params.localPort
    this.connectionId = params.connection.id
    this.poolCache = new MySQLPoolCache(this.connectionId, this.connection, this.localPort)
  }

  getPoolDebugSnapshot(): MySQLDriverPoolDebugSnapshot {
    return this.poolCache.getDebugSnapshot()
  }

  async testConnection(): Promise<string> {
    const opts = this.poolCache.buildPoolOptions()
    const tmp = mysql.createPool({ ...opts, connectionLimit: 1 })
    try {
      const [rows] = await tmp.query<RowDataPacket[]>('SELECT VERSION() AS v')
      return `OK · MySQL ${rows[0]?.['v']}`
    } finally {
      await tmp.end()
    }
  }

  async listDatabases(): Promise<string[]> {
    return this.withServerConnection(async (connection) => {
      const [rows] = await connection.query<RowDataPacket[]>('SHOW DATABASES')
      return rows
        .map((row) => Object.values(row)[0] as string)
        .filter((database) => !SYSTEM_DATABASES.has(database))
    })
  }

  async getDatabaseInfo(database: string): Promise<DatabaseInfo> {
    assertNonEmptySQL('database', database)

    return this.withServerConnection(async (connection) => {
      const [databaseRows] = await connection.query<RowDataPacket[]>(
        `SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
         FROM information_schema.SCHEMATA
         WHERE SCHEMA_NAME = ?
         LIMIT 1`,
        [database]
      )
      if (databaseRows.length === 0) {
        throw new Error(`Database "${database}" not found`)
      }

      const [statRows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS TABLE_COUNT,
                COALESCE(SUM(TABLE_ROWS), 0) AS ROW_ESTIMATE,
                COALESCE(SUM(DATA_LENGTH), 0) AS DATA_LENGTH,
                COALESCE(SUM(INDEX_LENGTH), 0) AS INDEX_LENGTH,
                COALESCE(SUM(DATA_FREE), 0) AS DATA_FREE
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
        [database]
      )

      const dataLength = Number(statRows[0]?.['DATA_LENGTH'] ?? 0)
      const indexLength = Number(statRows[0]?.['INDEX_LENGTH'] ?? 0)

      return {
        name: database,
        tableCount: Number(statRows[0]?.['TABLE_COUNT'] ?? 0),
        rowEstimate: Number(statRows[0]?.['ROW_ESTIMATE'] ?? 0),
        dataLength,
        indexLength,
        totalSize: dataLength + indexLength,
        dataFree: Number(statRows[0]?.['DATA_FREE'] ?? 0),
        charset: databaseRows[0]?.['DEFAULT_CHARACTER_SET_NAME'] as string | undefined,
        collation: databaseRows[0]?.['DEFAULT_COLLATION_NAME'] as string | undefined
      }
    })
  }

  async listTables(database: string): Promise<string[]> {
    return this.poolCache.withPool(database, async (pool) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT TABLE_NAME FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
         ORDER BY TABLE_NAME`,
        [database]
      )
      return rows.map((r) => r['TABLE_NAME'] as string)
    })
  }

  async getTableSchema(database: string, table: string): Promise<TableSchema> {
    return this.poolCache.withPool(database, async (pool) => {
      const [colRows] = await pool.query<RowDataPacket[]>(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
                COLUMN_KEY, EXTRA, COLUMN_COMMENT
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [database, table]
      )

      const columns: ColumnInfo[] = colRows.map((r) => ({
        name: r['COLUMN_NAME'] as string,
        type: r['COLUMN_TYPE'] as string,
        nullable: (r['IS_NULLABLE'] as string) === 'YES',
        defaultValue: (r['COLUMN_DEFAULT'] as string | null) ?? null,
        isPrimaryKey: r['COLUMN_KEY'] === 'PRI',
        isAutoIncrement:
          typeof r['EXTRA'] === 'string' && r['EXTRA'].includes('auto_increment'),
        comment: (r['COLUMN_COMMENT'] as string) || '',
        columnKey: (r['COLUMN_KEY'] as string) || ''
      }))

      const [idxRows] = await pool.query<RowDataPacket[]>(
        `SELECT INDEX_NAME, NON_UNIQUE, INDEX_TYPE, COLUMN_NAME, SEQ_IN_INDEX
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [database, table]
      )
      const indexMap = new Map<string, IndexInfo>()
      for (const r of idxRows) {
        const name = r['INDEX_NAME'] as string
        if (!indexMap.has(name)) {
          indexMap.set(name, {
            name,
            columns: [],
            unique: r['NON_UNIQUE'] === 0 || r['NON_UNIQUE'] === '0',
            type: (r['INDEX_TYPE'] as string) || 'BTREE'
          })
        }
        indexMap.get(name)!.columns.push(r['COLUMN_NAME'] as string)
      }
      const indexes = Array.from(indexMap.values())
      const primaryKey = indexes.find((i) => i.name === 'PRIMARY')?.columns ?? []

      const [createRows] = await pool.query<RowDataPacket[]>(
        `SHOW CREATE TABLE ${this.dialect.quoteTable(database, table)}`
      )
      const createSQL = (createRows[0]?.['Create Table'] as string) || ''

      const [statRows] = await pool.query<RowDataPacket[]>(
        `SELECT TABLE_ROWS, ENGINE, TABLE_COLLATION, TABLE_COMMENT,
                DATA_LENGTH, INDEX_LENGTH, DATA_FREE, AVG_ROW_LENGTH,
                AUTO_INCREMENT, CREATE_TIME, UPDATE_TIME
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [database, table]
      )

      return {
        name: table,
        columns,
        indexes,
        primaryKey,
        createSQL,
        rowEstimate: Number(statRows[0]?.['TABLE_ROWS'] ?? 0),
        engine: statRows[0]?.['ENGINE'] as string,
        charset: statRows[0]?.['TABLE_COLLATION'] as string,
        tableComment: (statRows[0]?.['TABLE_COMMENT'] as string) || '',
        dataLength: Number(statRows[0]?.['DATA_LENGTH'] ?? 0),
        indexLength: Number(statRows[0]?.['INDEX_LENGTH'] ?? 0),
        dataFree: Number(statRows[0]?.['DATA_FREE'] ?? 0),
        avgRowLength: Number(statRows[0]?.['AVG_ROW_LENGTH'] ?? 0),
        autoIncrement: (statRows[0]?.['AUTO_INCREMENT'] as number | null | undefined) ?? null,
        createdAt: (statRows[0]?.['CREATE_TIME'] as string | null | undefined) ?? null,
        updatedAt: (statRows[0]?.['UPDATE_TIME'] as string | null | undefined) ?? null
      }
    })
  }

  async queryRows(req: QueryRowsRequest) {
    assertNonEmptySQL('database', req.database)
    assertNonEmptySQL('table', req.table)
    assertSafeWhereClause(req.where)

    return this.poolCache.withPool(req.database, async (pool) => {
      const safeTable = this.dialect.quoteTable(req.database, req.table)
      const whereClause = req.where && req.where.trim() ? `WHERE ${req.where}` : ''
      const orderClause = req.orderBy
        ? `ORDER BY ${this.dialect.quoteIdent(req.orderBy.column)} ${req.orderBy.dir}`
        : ''
      const offset = Math.max(0, (req.page - 1) * req.pageSize)
      const limit = Math.max(1, Math.min(req.pageSize, MAX_PAGE_SIZE))

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM ${safeTable} ${whereClause} ${orderClause} LIMIT ${limit} OFFSET ${offset}`
      )
      const [countRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM ${safeTable} ${whereClause}`
      )
      return {
        rows: rows as Record<string, unknown>[],
        total: Number(countRows[0]?.['c'] ?? 0)
      }
    })
  }

  async insertRow(req: InsertRowRequest): Promise<{ insertId: number | string; affectedRows: number }> {
    const cols = Object.keys(req.values)
    if (cols.length === 0) throw new Error('No values to insert')
    assertNonEmptySQL('table', req.table)
    assertColumns(cols, 'insert')

    return this.poolCache.withPool(req.database, async (pool) => {
      const placeholders = cols.map(() => '?').join(', ')
      const sql = `INSERT INTO ${this.dialect.quoteTable(req.database, req.table)}
        (${cols.map((c) => this.dialect.quoteIdent(c)).join(', ')})
        VALUES (${placeholders})`
      const [res] = await pool.execute<ResultSetHeader>(sql, cols.map((c) => req.values[c]))
      return { insertId: res.insertId, affectedRows: res.affectedRows }
    })
  }

  async updateRow(req: UpdateRowRequest): Promise<{ affectedRows: number }> {
    const pkCols = Object.keys(req.pkValues)
    if (pkCols.length === 0) throw new Error('Refusing to UPDATE without primary key')
    const setCols = Object.keys(req.changes)
    if (setCols.length === 0) return { affectedRows: 0 }
    assertNonEmptySQL('table', req.table)
    assertColumns(pkCols, 'primary key')
    assertColumns(setCols, 'update')

    return this.poolCache.withPool(req.database, async (pool) => {
      const setClause = setCols.map((c) => `${this.dialect.quoteIdent(c)} = ?`).join(', ')
      const whereClause = pkCols.map((c) => `${this.dialect.quoteIdent(c)} = ?`).join(' AND ')
      const sql = `UPDATE ${this.dialect.quoteTable(req.database, req.table)} SET ${setClause} WHERE ${whereClause} LIMIT 1`
      const params = [
        ...setCols.map((c) => req.changes[c]),
        ...pkCols.map((c) => req.pkValues[c])
      ]
      const [res] = await pool.execute<ResultSetHeader>(sql, params)
      return { affectedRows: res.affectedRows }
    })
  }

  async deleteRows(req: DeleteRowsRequest): Promise<{ affectedRows: number }> {
    if (req.pkRows.length === 0) return { affectedRows: 0 }
    assertNonEmptySQL('table', req.table)

    return this.poolCache.withPool(req.database, async (pool) => {
      const conn = await pool.getConnection()
      const tableName = this.dialect.quoteTable(req.database, req.table)
      try {
        await conn.beginTransaction()
        let affected = 0
        for (const row of req.pkRows) {
          const cols = Object.keys(row)
          if (cols.length === 0) throw new Error('Refusing to DELETE without primary key')
          assertColumns(cols, 'primary key')
          const where = cols.map((c) => `${this.dialect.quoteIdent(c)} = ?`).join(' AND ')
          const [res] = await conn.execute<ResultSetHeader>(
            `DELETE FROM ${tableName} WHERE ${where} LIMIT 1`,
            cols.map((c) => row[c])
          )
          affected += res.affectedRows
        }
        await conn.commit()
        return { affectedRows: affected }
      } catch (err) {
        await conn.rollback()
        throw err
      } finally {
        conn.release()
      }
    })
  }

  async renameTable(req: RenameTableRequest): Promise<{ table: string }> {
    const nextName = req.newTable.trim()
    if (!nextName) throw new Error('New table name is required')
    if (nextName === req.table) return { table: req.table }
    await this.assertSourceExists(req.database, req.table)
    await this.assertTargetAbsent(req.database, nextName)

    return this.poolCache.withPool(req.database, async (pool) => {
      await pool.query(
        `RENAME TABLE ${this.dialect.quoteTable(req.database, req.table)} TO ${this.dialect.quoteTable(req.database, nextName)}`
      )
      return { table: nextName }
    })
  }

  async copyTable(req: CopyTableRequest): Promise<{ table: string }> {
    const targetTable = req.targetTable.trim()
    if (!targetTable) throw new Error('Target table name is required')
    if (targetTable === req.table) throw new Error('Target table name must be different')
    await this.assertSourceExists(req.database, req.table)
    await this.assertTargetAbsent(req.database, targetTable)

    return this.poolCache.withPool(req.database, async (pool) => {
      const sourceName = this.dialect.quoteTable(req.database, req.table)
      const nextName = this.dialect.quoteTable(req.database, targetTable)
      let created = false
      try {
        await pool.query(`CREATE TABLE ${nextName} LIKE ${sourceName}`)
        created = true
        await pool.query(`INSERT INTO ${nextName} SELECT * FROM ${sourceName}`)
        return { table: targetTable }
      } catch (err) {
        if (created) {
          await pool.query(`DROP TABLE ${nextName}`).catch(() => undefined)
        }
        throw err
      }
    })
  }

  async dropDatabase(req: DropDatabaseRequest): Promise<void> {
    assertNonEmptySQL('database', req.database)
    if (SYSTEM_DATABASES.has(req.database)) {
      throw new Error(`Refusing to drop system database "${req.database}"`)
    }

    await this.assertDatabaseExists(req.database)

    await this.withServerConnection(async (connection) => {
      await connection.query(`DROP DATABASE ${this.dialect.quoteIdent(req.database)}`)
    })

    await this.poolCache.removePool(req.database)
  }

  async dropTable(req: DropTableRequest): Promise<void> {
    await this.assertSourceExists(req.database, req.table)
    await this.poolCache.withPool(req.database, async (pool) => {
      await pool.query(`DROP TABLE ${this.dialect.quoteTable(req.database, req.table)}`)
    })
  }

  async executeSQL(sql: string, database?: string): Promise<unknown> {
    if (!sql.trim()) throw new Error('SQL is required')
    const opts = this.poolCache.buildPoolOptions(database)
    const client = await mysql.createConnection({ ...opts, multipleStatements: true })
    try {
      const [res] = await client.query(sql)
      return res
    } finally {
      await client.end()
    }
  }

  async explainSQL(sql: string, database?: string): Promise<ExplainSQLResult> {
    const statement = prepareExplainTarget(sql)
    const opts = this.poolCache.buildPoolOptions(database)
    const client = await mysql.createConnection({ ...opts, multipleStatements: false })
    try {
      let planPayload: unknown = null
      let plainRows: Record<string, unknown>[] = []

      try {
        const [jsonRows] = await client.query<RowDataPacket[]>(`EXPLAIN FORMAT=JSON ${statement}`)
        const explainValue = jsonRows[0]?.['EXPLAIN'] ?? Object.values(jsonRows[0] ?? {})[0]
        planPayload = typeof explainValue === 'string' ? JSON.parse(explainValue) : explainValue
      } catch {
        planPayload = null
      }

      const [rows] = await client.query<RowDataPacket[]>(`EXPLAIN ${statement}`)
      plainRows = rows as Record<string, unknown>[]

      return planPayload
        ? buildMySQLExplainResult(statement, planPayload, plainRows)
        : buildPlainExplainResult('mysql', statement, plainRows)
    } finally {
      await client.end()
    }
  }

  async *streamRows(opts: StreamRowsOptions): AsyncGenerator<Record<string, unknown>[]> {
    if (opts.columns.length === 0) return

    const lease = await this.poolCache.acquirePool(opts.database)
    try {
      const tableName = this.dialect.quoteTable(opts.database, opts.table)
      const columnList = opts.columns.map((c) => this.dialect.quoteIdent(c)).join(', ')
      const whereClause = opts.where && opts.where.trim() ? `WHERE ${opts.where.trim()}` : ''
      const orderClause = buildMySQLOrderClause(
        opts.columns.map((name) => ({ name }) as ColumnInfo),
        opts.primaryKey,
        opts.orderBy
      )

      let offset = 0
      let remaining = opts.limit
      while (remaining === undefined || remaining > 0) {
        const batchLimit =
          remaining === undefined ? opts.batchSize : Math.min(opts.batchSize, remaining)
        const [rows] = await lease.pool.query<RowDataPacket[]>(
          `SELECT ${columnList} FROM ${tableName} ${whereClause} ${orderClause} LIMIT ${batchLimit} OFFSET ${offset}`
        )
        if (rows.length === 0) return
        yield rows as Record<string, unknown>[]
        offset += rows.length
        if (remaining !== undefined) remaining -= rows.length
        if (rows.length < batchLimit) return
      }
    } finally {
      lease.release()
    }
  }

  async close(): Promise<void> {
    await this.poolCache.close()
  }

  private async tableExists(database: string, table: string): Promise<boolean> {
    return this.poolCache.withPool(database, async (pool) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT 1 AS present
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         LIMIT 1`,
        [database, table]
      )
      return rows.length > 0
    })
  }

  private async assertSourceExists(database: string, table: string): Promise<void> {
    if (!(await this.tableExists(database, table))) {
      throw new Error(`Table "${table}" not found`)
    }
  }

  private async assertTargetAbsent(database: string, table: string): Promise<void> {
    if (await this.tableExists(database, table)) {
      throw new Error(`Table "${table}" already exists`)
    }
  }

  private async databaseExists(database: string): Promise<boolean> {
    return this.withServerConnection(async (connection) => {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT 1 AS present
         FROM information_schema.SCHEMATA
         WHERE SCHEMA_NAME = ?
         LIMIT 1`,
        [database]
      )
      return rows.length > 0
    })
  }

  private async assertDatabaseExists(database: string): Promise<void> {
    if (!(await this.databaseExists(database))) {
      throw new Error(`Database "${database}" not found`)
    }
  }

  private async withServerConnection<T>(run: (connection: Connection) => Promise<T>): Promise<T> {
    const connection = await mysql.createConnection({
      ...this.poolCache.buildPoolOptions(),
      database: undefined,
      multipleStatements: false
    })

    try {
      return await run(connection)
    } finally {
      await connection.end()
    }
  }
}

function assertColumns(columns: string[], label: string): void {
  for (const column of columns) {
    assertNonEmptySQL(`${label} column`, column)
  }
}

function assertSafeWhereClause(where?: string): void {
  if (!where?.trim()) return
  const trimmed = where.trim()
  if (trimmed.includes(';')) {
    throw new Error('WHERE clause must not contain semicolons')
  }
  if (/--|\/\*/.test(trimmed)) {
    throw new Error('WHERE clause must not contain SQL comments')
  }
}

function assertNonEmptySQL(label: string, value: string): void {
  if (!value.trim()) {
    throw new Error(`${label} is required`)
  }
}
