import { createClient } from 'redis'
import type {
  ColumnInfo,
  ConnectionConfig,
  CopyTableRequest,
  DatabaseInfo,
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
import type { DbDriver, Dialect, StreamRowsOptions } from './types'

type RedisClient = ReturnType<typeof createClient>
type RedisKeyType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'none'

const MAX_PAGE_SIZE = 1000
const MAX_LISTED_KEYS = 10000

const redisDialect: Dialect = {
  engine: 'redis',
  quoteIdent(name) {
    return name
  },
  quoteTable(_database, table) {
    return table
  },
  formatLiteral(value) {
    return String(value ?? '')
  },
  renderInsert() {
    throw unsupportedRedisOperation('Insert')
  },
  renderTruncate() {
    throw unsupportedRedisOperation('Truncate')
  },
  renderDropIfExists() {
    throw unsupportedRedisOperation('Drop')
  },
  stripDefiner(sql) {
    return sql
  }
}

export class RedisDriver implements DbDriver {
  readonly engine = 'redis' as const
  readonly dialect: Dialect = redisDialect
  readonly connectionId: string

  private readonly connection: ConnectionConfig
  private readonly localPort: number | undefined
  private clients = new Map<string, RedisClient>()

  constructor(params: { connection: ConnectionConfig; localPort?: number }) {
    this.connection = params.connection
    this.localPort = params.localPort
    this.connectionId = params.connection.id
  }

  async testConnection(): Promise<string> {
    const client = this.createClient(parseRedisDatabase(this.connection.database))
    try {
      await client.connect()
      await client.ping()
      const info = parseRedisInfo(String(await client.sendCommand(['INFO', 'server'])))
      return `OK · Redis ${info.get('redis_version') ?? ''}`.trim()
    } finally {
      await closeRedisClient(client)
    }
  }

  async listDatabases(): Promise<string[]> {
    const client = await this.getClient(this.connection.database)
    try {
      const configured = await client.sendCommand(['CONFIG', 'GET', 'databases'])
      const count = readRedisDatabaseCount(configured)
      if (count > 0) return Array.from({ length: count }, (_item, index) => String(index))
    } catch {
      // Managed Redis often disables CONFIG; fall back to the configured logical DB.
    }
    return [String(parseRedisDatabase(this.connection.database))]
  }

  async getDatabaseInfo(database: string): Promise<DatabaseInfo> {
    const client = await this.getClient(database)
    const [size, infoText] = await Promise.all([
      client.dbSize(),
      client.sendCommand(['INFO']).catch(() => '')
    ])
    const info = parseRedisInfo(String(infoText))
    const usedMemory = numberFromInfo(info.get('used_memory'))

    return {
      name: String(parseRedisDatabase(database)),
      tableCount: size,
      rowEstimate: size,
      dataLength: usedMemory,
      totalSize: usedMemory,
      charset: 'binary-safe strings',
      owner: info.get('redis_version') ? `Redis ${info.get('redis_version')}` : 'Redis',
      comment: `Redis logical database ${parseRedisDatabase(database)}`
    }
  }

  async listTables(database: string): Promise<string[]> {
    const client = await this.getClient(database)
    const keys: string[] = []
    for await (const key of client.scanIterator({ COUNT: 1000 })) {
      keys.push(String(key))
      if (keys.length >= MAX_LISTED_KEYS) break
    }
    return keys.sort((left, right) => left.localeCompare(right))
  }

  async getTableSchema(database: string, table: string): Promise<TableSchema> {
    const client = await this.getClient(database)
    const keyType = await getRedisKeyType(client, table)
    if (keyType === 'none') throw new Error(`Redis key "${table}" not found`)

    const [ttl, memoryBytes, rowEstimate] = await Promise.all([
      client.ttl(table).catch(() => -2),
      getMemoryUsage(client, table),
      getRedisValueLength(client, table, keyType)
    ])

    return {
      name: table,
      columns: getRedisColumns(keyType),
      indexes: [],
      primaryKey: [],
      createSQL: renderRedisKeyMetadata(table, keyType, ttl, memoryBytes, rowEstimate),
      rowEstimate,
      engine: `Redis ${keyType}`,
      charset: 'binary-safe strings',
      tableComment: ttl >= 0 ? `TTL ${ttl}s` : ttl === -1 ? 'No expiration' : '',
      dataLength: memoryBytes ?? undefined,
      indexLength: 0,
      dataFree: 0,
      avgRowLength: rowEstimate > 0 && memoryBytes ? Math.round(memoryBytes / rowEstimate) : 0,
      autoIncrement: null,
      createdAt: null,
      updatedAt: null
    }
  }

  async queryRows(req: QueryRowsRequest): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    if (req.where?.trim()) throw new Error('Redis key filtering is not supported')

    const client = await this.getClient(req.database)
    const keyType = await getRedisKeyType(client, req.table)
    if (keyType === 'none') throw new Error(`Redis key "${req.table}" not found`)

    const page = Math.max(1, req.page || 1)
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, req.pageSize || 100))
    const start = (page - 1) * pageSize
    const stop = start + pageSize - 1

    switch (keyType) {
      case 'string': {
        const [value, ttl, memoryBytes] = await Promise.all([
          client.get(req.table),
          client.ttl(req.table).catch(() => -2),
          getMemoryUsage(client, req.table)
        ])
        return {
          total: 1,
          rows: page === 1 ? [{ key: req.table, type: keyType, value, ttlSeconds: ttl, memoryBytes }] : []
        }
      }
      case 'hash': {
        const values = await client.hGetAll(req.table)
        const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right))
        return {
          total: entries.length,
          rows: entries.slice(start, start + pageSize).map(([field, value]) => ({ field, value }))
        }
      }
      case 'list': {
        const total = await client.lLen(req.table)
        const values = await client.lRange(req.table, start, stop)
        return {
          total,
          rows: values.map((value, index) => ({ index: start + index, value }))
        }
      }
      case 'set': {
        const members = (await client.sMembers(req.table)).sort((left, right) => left.localeCompare(right))
        return {
          total: members.length,
          rows: members.slice(start, start + pageSize).map((member) => ({ member }))
        }
      }
      case 'zset': {
        const total = await client.zCard(req.table)
        const values = await client.zRangeWithScores(req.table, start, stop)
        return {
          total,
          rows: values.map((item) => ({ member: item.value, score: item.score }))
        }
      }
      case 'stream': {
        const total = await client.xLen(req.table)
        const entries = await readStreamEntries(client, req.table, start + pageSize)
        return {
          total,
          rows: entries.slice(start, start + pageSize)
        }
      }
      default:
        return { total: 0, rows: [] }
    }
  }

  async insertRow(_req: InsertRowRequest): Promise<{ insertId: number | string; affectedRows: number }> {
    throw unsupportedRedisOperation('Insert')
  }

  async updateRow(_req: UpdateRowRequest): Promise<{ affectedRows: number }> {
    throw unsupportedRedisOperation('Update')
  }

  async deleteRows(_req: DeleteRowsRequest): Promise<{ affectedRows: number }> {
    throw unsupportedRedisOperation('Delete rows')
  }

  async renameTable(_req: RenameTableRequest): Promise<{ table: string }> {
    throw unsupportedRedisOperation('Rename')
  }

  async copyTable(_req: CopyTableRequest): Promise<{ table: string }> {
    throw unsupportedRedisOperation('Copy')
  }

  async dropDatabase(_req: DropDatabaseRequest): Promise<void> {
    throw unsupportedRedisOperation('Drop database')
  }

  async dropTable(_req: DropTableRequest): Promise<void> {
    throw unsupportedRedisOperation('Drop key')
  }

  async executeSQL(_sql: string, _database?: string): Promise<unknown> {
    throw unsupportedRedisOperation('SQL execution')
  }

  async explainSQL(_sql: string, _database?: string): Promise<ExplainSQLResult> {
    throw unsupportedRedisOperation('Explain')
  }

  async *streamRows(_opts: StreamRowsOptions): AsyncIterable<Record<string, unknown>[]> {
    throw unsupportedRedisOperation('Export')
  }

  async close(): Promise<void> {
    const clients = Array.from(this.clients.values())
    this.clients.clear()
    await Promise.all(clients.map(closeRedisClient))
  }

  private async getClient(database?: string): Promise<RedisClient> {
    const db = parseRedisDatabase(database ?? this.connection.database)
    const key = String(db)
    const cached = this.clients.get(key)
    if (cached) return cached

    const client = this.createClient(db)
    client.on('error', () => undefined)
    await client.connect()
    this.clients.set(key, client)
    return client
  }

  private createClient(database: number): RedisClient {
    return createClient({
      username: this.connection.username?.trim() || undefined,
      password: this.connection.password || undefined,
      database,
      socket: {
        host: this.localPort !== undefined ? '127.0.0.1' : this.connection.host,
        port: this.localPort ?? this.connection.port
      }
    })
  }
}

function getRedisColumns(type: RedisKeyType): ColumnInfo[] {
  switch (type) {
    case 'string':
      return [
        column('key', 'redis-key'),
        column('type', 'string'),
        column('value', 'string'),
        column('ttlSeconds', 'number'),
        column('memoryBytes', 'number')
      ]
    case 'hash':
      return [column('field', 'hash-field'), column('value', 'string')]
    case 'list':
      return [column('index', 'number'), column('value', 'string')]
    case 'set':
      return [column('member', 'string')]
    case 'zset':
      return [column('member', 'string'), column('score', 'number')]
    case 'stream':
      return [column('id', 'stream-id'), column('fields', 'json')]
    default:
      return [column('key', 'redis-key'), column('type', 'unknown')]
  }
}

function column(name: string, type: string): ColumnInfo {
  return {
    name,
    type,
    nullable: true,
    defaultValue: null,
    isPrimaryKey: false,
    isAutoIncrement: false,
    comment: '',
    columnKey: ''
  }
}

function parseRedisDatabase(database?: string): number {
  const raw = database?.trim() || '0'
  const value = Number.parseInt(raw, 10)
  if (!Number.isInteger(value) || value < 0) throw new Error('Redis database must be a non-negative integer')
  return value
}

async function getRedisKeyType(client: RedisClient, key: string): Promise<RedisKeyType> {
  const type = String(await client.type(key)) as RedisKeyType
  return type
}

async function getRedisValueLength(client: RedisClient, key: string, type: RedisKeyType): Promise<number> {
  switch (type) {
    case 'string':
      return 1
    case 'hash':
      return client.hLen(key)
    case 'list':
      return client.lLen(key)
    case 'set':
      return client.sCard(key)
    case 'zset':
      return client.zCard(key)
    case 'stream':
      return client.xLen(key)
    default:
      return 0
  }
}

async function getMemoryUsage(client: RedisClient, key: string): Promise<number | null> {
  try {
    const value = await client.sendCommand(['MEMORY', 'USAGE', key])
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function readStreamEntries(
  client: RedisClient,
  key: string,
  count: number
): Promise<Record<string, unknown>[]> {
  const raw = await client.sendCommand(['XRANGE', key, '-', '+', 'COUNT', String(Math.max(1, count))])
  if (!Array.isArray(raw)) return []

  return raw.flatMap((entry) => {
    if (!Array.isArray(entry)) return []
    const [id, fields] = entry
    return [{ id: String(id), fields: normalizeStreamFields(fields) }]
  })
}

function normalizeStreamFields(fields: unknown): Record<string, string> {
  if (!Array.isArray(fields)) return {}
  const result: Record<string, string> = {}
  for (let index = 0; index < fields.length; index += 2) {
    const field = fields[index]
    const value = fields[index + 1]
    if (field !== undefined) result[String(field)] = value === undefined ? '' : String(value)
  }
  return result
}

function readRedisDatabaseCount(value: unknown): number {
  if (!Array.isArray(value)) return 0
  const index = value.findIndex((item) => String(item).toLowerCase() === 'databases')
  const raw = index >= 0 ? value[index + 1] : value[1]
  const count = Number(raw)
  return Number.isInteger(count) && count > 0 ? count : 0
}

function parseRedisInfo(info: string): Map<string, string> {
  const map = new Map<string, string>()
  info.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const separator = trimmed.indexOf(':')
    if (separator <= 0) return
    map.set(trimmed.slice(0, separator), trimmed.slice(separator + 1))
  })
  return map
}

function numberFromInfo(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function renderRedisKeyMetadata(
  key: string,
  type: RedisKeyType,
  ttl: number,
  memoryBytes: number | null,
  length: number
): string {
  return [
    `KEY ${key}`,
    `TYPE ${type}`,
    `LENGTH ${length}`,
    `TTL ${ttl}`,
    memoryBytes === null ? '' : `MEMORY USAGE ${memoryBytes}`
  ].filter(Boolean).join('\n')
}

async function closeRedisClient(client: RedisClient): Promise<void> {
  try {
    if (client.isOpen) await client.quit()
  } catch {
    client.disconnect()
  }
}

function unsupportedRedisOperation(action: string): Error {
  return new Error(`${action} is not available for Redis connections`)
}