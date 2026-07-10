// Postgres 驱动实现。UI 语义上的 "database" 直接映射到 PG 的 database
// （PG schema 在 MVP 阶段硬编码为 'public'）。因为每个 pg 连接绑定单个 database，
// 这里按 database 名维护一组 pg.Pool。
import pg from 'pg'
import type { PoolClient, QueryResultRow } from 'pg'
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
import { pgDialect, renderPgCreateTable } from './pg-dialect'
import {
  buildPlainExplainResult,
  buildPostgresExplainResult,
  prepareExplainTarget
} from './explain-utils'
import {
  assertColumns,
  assertNonEmptySQL,
  assertSafeWhereClause,
  buildPgOrderClause,
  formatPgType,
  parseIndexDef,
  qualifiedName
} from './pg-driver-utils'
import { resolveQueryOrderContext, buildDefaultOrderBy } from './query-order-utils'

const MAX_PAGE_SIZE = 1000
const DEFAULT_SCHEMA = 'public'

export class PostgresDriver implements DbDriver {
  readonly engine = 'postgres' as const
  readonly dialect: Dialect = pgDialect
  readonly connectionId: string

  private pools = new Map<string, pg.Pool>()
  private readonly connection: ConnectionConfig
  private readonly localPort: number | undefined

  constructor(params: { connection: ConnectionConfig; localPort?: number }) {
    this.connection = params.connection
    this.localPort = params.localPort
    this.connectionId = params.connection.id
  }

  private buildClientConfig(database?: string): pg.PoolConfig {
    const host = this.localPort !== undefined ? '127.0.0.1' : this.connection.host
    const port = this.localPort ?? this.connection.port
    const databaseCredential = database ? this.connection.databaseCredentials?.[database] : undefined
    return {
      host,
      port,
      user: databaseCredential?.username?.trim() || this.connection.username,
      password: normalizePostgresPassword(databaseCredential?.password ?? this.connection.password),
      database: database || this.connection.database || 'postgres',
      max: 5,
      idleTimeoutMillis: 30000
    }
  }

  private async getPool(database?: string): Promise<pg.Pool> {
    const key = database || this.connection.database || 'postgres'
    const cached = this.pools.get(key)
    if (cached) return cached
    const pool = new pg.Pool(this.buildClientConfig(key))
    this.pools.set(key, pool)
    return pool
  }

  async testConnection(): Promise<string> {
    const client = new pg.Client(this.buildClientConfig(this.connection.database))
    try {
      await client.connect()
      const res = await client.query<{ server_version: string }>('SHOW server_version')
      return `OK · PostgreSQL ${res.rows[0]?.server_version ?? ''}`
    } catch (error) {
      throw normalizePostgresConnectionError(error)
    } finally {
      await client.end()
    }
  }

  async listDatabases(): Promise<string[]> {
    return this.withMaintenanceClient(undefined, async (client) => {
      const result = await client.query<{ datname: string }>(
        `SELECT datname FROM pg_database
         WHERE NOT datistemplate
           AND datallowconn
           AND has_database_privilege(datname, 'CONNECT')
         ORDER BY datname`
      )
      return result.rows.map((row) => row.datname)
    })
  }

  async getDatabaseInfo(database: string): Promise<DatabaseInfo> {
    assertNonEmptySQL('database', database)

    const metadata = await this.withMaintenanceClient(database, async (client) => {
      const result = await client.query<{
        datname: string
        encoding: string
        datcollate: string
        owner: string
        comment: string | null
        total_size: string
      }>(
        `SELECT datname,
                pg_encoding_to_char(encoding) AS encoding,
                datcollate,
                pg_get_userbyid(datdba) AS owner,
                shobj_description(oid, 'pg_database') AS comment,
                pg_database_size(datname)::bigint AS total_size
         FROM pg_database
         WHERE datname = $1
         LIMIT 1`,
        [database]
      )
      if ((result.rowCount ?? 0) === 0) {
        throw new Error(`Database "${database}" not found`)
      }
      return result.rows[0]!
    })

    const pool = await this.getPool(database)
    const tableCountResult = await pool.query<{ table_count: string }>(
      `SELECT COUNT(*)::bigint AS table_count
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
      [DEFAULT_SCHEMA]
    )
    const statsResult = await pool.query<{
      row_estimate: string
      data_length: string
      index_length: string
    }>(
      `SELECT COALESCE(SUM(c.reltuples), 0)::bigint AS row_estimate,
              COALESCE(SUM(pg_table_size(c.oid)), 0)::bigint AS data_length,
              COALESCE(SUM(pg_indexes_size(c.oid)), 0)::bigint AS index_length
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind = 'r'`,
      [DEFAULT_SCHEMA]
    )

    const dataLength = Number(statsResult.rows[0]?.data_length ?? 0)
    const indexLength = Number(statsResult.rows[0]?.index_length ?? 0)

    return {
      name: database,
      tableCount: Number(tableCountResult.rows[0]?.table_count ?? 0),
      rowEstimate: Number(statsResult.rows[0]?.row_estimate ?? 0),
      dataLength,
      indexLength,
      totalSize: Number(metadata.total_size ?? 0),
      charset: metadata.encoding,
      collation: metadata.datcollate,
      owner: metadata.owner,
      comment: metadata.comment ?? undefined
    }
  }

  async listTables(database: string): Promise<string[]> {
    const pool = await this.getPool(database)
    const res = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [DEFAULT_SCHEMA]
    )
    return res.rows.map((r) => r.table_name)
  }

  async getTableSchema(database: string, table: string): Promise<TableSchema> {
    const pool = await this.getPool(database)

    const colRes = await pool.query<{
      column_name: string
      data_type: string
      udt_name: string
      is_nullable: string
      column_default: string | null
      is_identity: string
      character_maximum_length: number | null
      numeric_precision: number | null
      numeric_scale: number | null
    }>(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default, is_identity,
              character_maximum_length, numeric_precision, numeric_scale
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [DEFAULT_SCHEMA, table]
    )

    const pkRes = await pool.query<{ column_name: string }>(
      `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary
       ORDER BY array_position(i.indkey, a.attnum)`,
      [qualifiedName(table)]
    )
    const primaryKey = pkRes.rows.map((r) => r.column_name)
    const pkSet = new Set(primaryKey)

    const uqRes = await pool.query<{ column_name: string }>(
      `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisunique AND NOT i.indisprimary`,
      [qualifiedName(table)]
    )
    const uniqueSet = new Set(uqRes.rows.map((r) => r.column_name))

    const columns: ColumnInfo[] = colRes.rows.map((r) => {
      const isPk = pkSet.has(r.column_name)
      const isUnique = uniqueSet.has(r.column_name)
      const isAutoInc =
        r.is_identity === 'YES' ||
        (typeof r.column_default === 'string' &&
          (r.column_default.startsWith('nextval(') ||
            r.column_default.toLowerCase().includes('identity')))
      return {
        name: r.column_name,
        type: formatPgType(r),
        nullable: r.is_nullable === 'YES',
        defaultValue: r.column_default,
        isPrimaryKey: isPk,
        isAutoIncrement: isAutoInc,
        comment: '',
        columnKey: isPk ? 'PRI' : isUnique ? 'UNI' : ''
      }
    })

    const idxRes = await pool.query<{
      indexname: string
      indexdef: string
    }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = $1 AND tablename = $2
       ORDER BY indexname`,
      [DEFAULT_SCHEMA, table]
    )
    const indexes: IndexInfo[] = idxRes.rows.map((r) => parseIndexDef(r.indexname, r.indexdef))

    const statRes = await pool.query<{
      reltuples: number
      obj_description: string | null
    }>(
      `SELECT c.reltuples::bigint AS reltuples, obj_description(c.oid, 'pg_class')
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = $2`,
      [DEFAULT_SCHEMA, table]
    )

    const tableComment = (statRes.rows[0]?.obj_description ?? '') || ''
    const schema: TableSchema = {
      name: table,
      columns,
      indexes,
      primaryKey,
      createSQL: '',
      rowEstimate: Number(statRes.rows[0]?.reltuples ?? 0),
      tableComment
    }
    schema.createSQL = renderPgCreateTable(schema, database)
    return schema
  }

  async queryRows(req: QueryRowsRequest) {
    assertNonEmptySQL('database', req.database)
    assertNonEmptySQL('table', req.table)
    assertSafeWhereClause(req.where)

    const pool = await this.getPool(req.database)
    const safeTable = this.dialect.quoteTable(DEFAULT_SCHEMA, req.table)
    const whereClause = req.where && req.where.trim() ? `WHERE ${req.where}` : ''
    const { primaryKey, columnNames } = await resolveQueryOrderContext(req, (database, table) =>
      this.getTableSchema(database, table)
    )
    const orderClause = buildPgOrderClause(columnNames, primaryKey, req.orderBy ?? buildDefaultOrderBy(primaryKey))
    const offset = Math.max(0, (req.page - 1) * req.pageSize)
    const limit = Math.max(1, Math.min(req.pageSize, MAX_PAGE_SIZE))

    const rowsRes = await pool.query(
      `SELECT * FROM ${safeTable} ${whereClause} ${orderClause} LIMIT ${limit} OFFSET ${offset}`
    )
    const countRes = await pool.query<{ c: string }>(
      `SELECT COUNT(*) AS c FROM ${safeTable} ${whereClause}`
    )
    return {
      rows: rowsRes.rows as Record<string, unknown>[],
      total: Number(countRes.rows[0]?.c ?? 0)
    }
  }

  async insertRow(
    req: InsertRowRequest
  ): Promise<{ insertId: number | string; affectedRows: number }> {
    const cols = Object.keys(req.values)
    if (cols.length === 0) throw new Error('No values to insert')
    assertNonEmptySQL('table', req.table)
    assertColumns(cols, 'insert')

    const pool = await this.getPool(req.database)
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
    const sql = `INSERT INTO ${this.dialect.quoteTable(DEFAULT_SCHEMA, req.table)}
      (${cols.map((c) => this.dialect.quoteIdent(c)).join(', ')})
      VALUES (${placeholders})`
    const res = await pool.query(sql, cols.map((c) => req.values[c]))
    return { insertId: 0, affectedRows: res.rowCount ?? 0 }
  }

  async updateRow(req: UpdateRowRequest): Promise<{ affectedRows: number }> {
    const pkCols = Object.keys(req.pkValues)
    if (pkCols.length === 0) throw new Error('Refusing to UPDATE without primary key')
    const setCols = Object.keys(req.changes)
    if (setCols.length === 0) return { affectedRows: 0 }
    assertNonEmptySQL('table', req.table)
    assertColumns(pkCols, 'primary key')
    assertColumns(setCols, 'update')

    const pool = await this.getPool(req.database)
    const setClause = setCols
      .map((c, i) => `${this.dialect.quoteIdent(c)} = $${i + 1}`)
      .join(', ')
    const whereClause = pkCols
      .map((c, i) => `${this.dialect.quoteIdent(c)} = $${setCols.length + i + 1}`)
      .join(' AND ')
    const sql = `UPDATE ${this.dialect.quoteTable(DEFAULT_SCHEMA, req.table)} SET ${setClause} WHERE ${whereClause}`
    const params = [...setCols.map((c) => req.changes[c]), ...pkCols.map((c) => req.pkValues[c])]
    const res = await pool.query(sql, params)
    return { affectedRows: res.rowCount ?? 0 }
  }

  async deleteRows(req: DeleteRowsRequest): Promise<{ affectedRows: number }> {
    if (req.pkRows.length === 0) return { affectedRows: 0 }
    assertNonEmptySQL('table', req.table)

    const pool = await this.getPool(req.database)
    const client: PoolClient = await pool.connect()
    const tableName = this.dialect.quoteTable(DEFAULT_SCHEMA, req.table)
    try {
      await client.query('BEGIN')
      let affected = 0
      for (const row of req.pkRows) {
        const cols = Object.keys(row)
        if (cols.length === 0) throw new Error('Refusing to DELETE without primary key')
        assertColumns(cols, 'primary key')
        const where = cols
          .map((c, i) => `${this.dialect.quoteIdent(c)} = $${i + 1}`)
          .join(' AND ')
        const res = await client.query(
          `DELETE FROM ${tableName} WHERE ${where}`,
          cols.map((c) => row[c])
        )
        affected += res.rowCount ?? 0
      }
      await client.query('COMMIT')
      return { affectedRows: affected }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
  }

  async renameTable(req: RenameTableRequest): Promise<{ table: string }> {
    const nextName = req.newTable.trim()
    if (!nextName) throw new Error('New table name is required')
    if (nextName === req.table) return { table: req.table }
    await this.assertSourceExists(req.database, req.table)
    await this.assertTargetAbsent(req.database, nextName)

    const pool = await this.getPool(req.database)
    await pool.query(
      `ALTER TABLE ${this.dialect.quoteTable(DEFAULT_SCHEMA, req.table)} RENAME TO ${this.dialect.quoteIdent(nextName)}`
    )
    return { table: nextName }
  }

  async copyTable(req: CopyTableRequest): Promise<{ table: string }> {
    const targetTable = req.targetTable.trim()
    if (!targetTable) throw new Error('Target table name is required')
    if (targetTable === req.table) throw new Error('Target table name must be different')
    await this.assertSourceExists(req.database, req.table)
    await this.assertTargetAbsent(req.database, targetTable)

    const pool = await this.getPool(req.database)
    const sourceName = this.dialect.quoteTable(DEFAULT_SCHEMA, req.table)
    const nextName = this.dialect.quoteTable(DEFAULT_SCHEMA, targetTable)
    let created = false
    try {
      await pool.query(`CREATE TABLE ${nextName} (LIKE ${sourceName} INCLUDING ALL)`)
      created = true
      await pool.query(`INSERT INTO ${nextName} SELECT * FROM ${sourceName}`)
      return { table: targetTable }
    } catch (err) {
      if (created) {
        await pool.query(`DROP TABLE ${nextName}`).catch(() => undefined)
      }
      throw err
    }
  }

  async dropDatabase(req: DropDatabaseRequest): Promise<void> {
    assertNonEmptySQL('database', req.database)

    await this.closePool(req.database)

    await this.withMaintenanceClient(req.database, async (client) => {
      const existsResult = await client.query<{ present: number }>(
        `SELECT 1 AS present FROM pg_database WHERE datname = $1 LIMIT 1`,
        [req.database]
      )
      if ((existsResult.rowCount ?? 0) === 0) {
        throw new Error(`Database "${req.database}" not found`)
      }

      await client.query(`DROP DATABASE ${this.dialect.quoteIdent(req.database)}`)
    })
  }

  async dropTable(req: DropTableRequest): Promise<void> {
    await this.assertSourceExists(req.database, req.table)
    const pool = await this.getPool(req.database)
    await pool.query(`DROP TABLE ${this.dialect.quoteTable(DEFAULT_SCHEMA, req.table)}`)
  }

  async executeSQL(sql: string, database?: string): Promise<unknown> {
    if (!sql.trim()) throw new Error('SQL is required')
    const client = new pg.Client(this.buildClientConfig(database))
    await client.connect()
    try {
      const res = await client.query(sql)
      if (Array.isArray(res)) {
        return res.map((r) => ({ rows: r.rows, rowCount: r.rowCount }))
      }
      return { rows: res.rows, rowCount: res.rowCount }
    } finally {
      await client.end()
    }
  }

  async explainSQL(sql: string, database?: string): Promise<ExplainSQLResult> {
    const statement = prepareExplainTarget(sql)
    const client = new pg.Client(this.buildClientConfig(database))
    await client.connect()
    try {
      let planPayload: unknown = null
      try {
        const jsonResult = await client.query<{ 'QUERY PLAN': unknown }>(
          `EXPLAIN (FORMAT JSON, COSTS TRUE, VERBOSE FALSE, BUFFERS FALSE) ${statement}`
        )
        planPayload = jsonResult.rows[0]?.['QUERY PLAN'] ?? null
      } catch {
        planPayload = null
      }

      const plainResult = await client.query<QueryResultRow>(`EXPLAIN ${statement}`)
      const rows = plainResult.rows as Record<string, unknown>[]
      return planPayload
        ? buildPostgresExplainResult(statement, planPayload, rows)
        : buildPlainExplainResult('postgres', statement, rows)
    } finally {
      await client.end()
    }
  }

  async *streamRows(opts: StreamRowsOptions): AsyncGenerator<Record<string, unknown>[]> {
    if (opts.columns.length === 0) return

    const pool = await this.getPool(opts.database)
    const tableName = this.dialect.quoteTable(DEFAULT_SCHEMA, opts.table)
    const columnList = opts.columns.map((c) => this.dialect.quoteIdent(c)).join(', ')
    const whereClause = opts.where && opts.where.trim() ? `WHERE ${opts.where.trim()}` : ''
    const orderClause = buildPgOrderClause(opts.columns, opts.primaryKey, opts.orderBy)

    let offset = 0
    let remaining = opts.limit
    while (remaining === undefined || remaining > 0) {
      const batchLimit =
        remaining === undefined ? opts.batchSize : Math.min(opts.batchSize, remaining)
      const res = await pool.query<QueryResultRow>(
        `SELECT ${columnList} FROM ${tableName} ${whereClause} ${orderClause} LIMIT ${batchLimit} OFFSET ${offset}`
      )
      if (res.rows.length === 0) return
      yield res.rows as Record<string, unknown>[]
      offset += res.rows.length
      if (remaining !== undefined) remaining -= res.rows.length
      if (res.rows.length < batchLimit) return
    }
  }

  async close(): Promise<void> {
    const pools = Array.from(this.pools.values())
    this.pools.clear()
    await Promise.all(pools.map((p) => p.end().catch(() => undefined)))
  }

  private async tableExists(database: string, table: string): Promise<boolean> {
    const pool = await this.getPool(database)
    const res = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2
       LIMIT 1`,
      [DEFAULT_SCHEMA, table]
    )
    return res.rowCount !== null && res.rowCount > 0
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

  private async closePool(database?: string): Promise<void> {
    const key = database || this.connection.database || 'postgres'
    const pool = this.pools.get(key)
    if (!pool) return

    this.pools.delete(key)
    await pool.end().catch(() => undefined)
  }

  private getMaintenanceCandidates(avoidDatabase?: string): string[] {
    return Array.from(
      new Set(
        [this.connection.database, 'postgres', 'template1'].filter(
          (database): database is string => Boolean(database && database !== avoidDatabase)
        )
      )
    )
  }

  private async withMaintenanceClient<T>(
    avoidDatabase: string | undefined,
    run: (client: pg.Client) => Promise<T>
  ): Promise<T> {
    let lastError: unknown = new Error('Unable to connect to a maintenance database')

    for (const database of this.getMaintenanceCandidates(avoidDatabase)) {
      const client = new pg.Client(this.buildClientConfig(database))
      try {
        await client.connect()
      } catch (error) {
        lastError = error
        await client.end().catch(() => undefined)
        continue
      }

      try {
        return await run(client)
      } finally {
        await client.end().catch(() => undefined)
      }
    }

    throw normalizePostgresConnectionError(lastError)
  }
}

function normalizePostgresPassword(password: string | undefined): string {
  return typeof password === 'string' ? password : ''
}

function normalizePostgresConnectionError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (
    message.includes('SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string') ||
    message.includes('SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a non-empty string')
  ) {
    return new Error('PostgreSQL database password is required. The SSH password only opens the tunnel; fill the database password in the connection settings.')
  }
  return error instanceof Error ? error : new Error(message)
}
