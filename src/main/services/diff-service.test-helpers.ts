import { vi } from 'vitest'
import type { DatabaseInfo, TableSchema } from '../../shared/types'
import type { DbDriver, Dialect } from './drivers/types'

const fakeDialect: Dialect = {
  engine: 'mysql',
  quoteIdent: (name) => `\`${name}\``,
  quoteTable: (database, table) => `\`${database}\`.\`${table}\``,
  formatLiteral: (value) => JSON.stringify(value),
  renderInsert: () => '',
  renderTruncate: () => '',
  renderDropIfExists: () => '',
  stripDefiner: (sql) => sql
}

const fakeDatabaseInfo: DatabaseInfo = {
  name: 'unused',
  tableCount: 0,
  rowEstimate: 0,
  dataLength: 0,
  indexLength: 0,
  totalSize: 0
}

export function createFakeDriver(options: {
  connectionId: string
  engine?: DbDriver['engine']
  tablesByDatabase?: Record<string, string[]>
  schemas?: Record<string, TableSchema>
  schemaImpl?: (database: string, table: string) => Promise<TableSchema>
  streamRowsByTable?: Record<string, Record<string, unknown>[][]>
}): {
  driver: DbDriver
  listTables: ReturnType<typeof vi.fn>
  getTableSchema: ReturnType<typeof vi.fn>
  streamRows: ReturnType<typeof vi.fn>
} {
  const listTables = vi.fn(async (database: string) => {
    return options.tablesByDatabase?.[database] ?? []
  })

  const getTableSchema = vi.fn(async (database: string, table: string) => {
    if (options.schemaImpl) {
      return options.schemaImpl(database, table)
    }

    const schema = options.schemas?.[`${database}.${table}`]
    if (!schema) {
      throw new Error(`Missing schema for ${database}.${table}`)
    }
    return schema
  })

  const streamRows = vi.fn(async function* (opts: { database: string; table: string }) {
    for (const batch of options.streamRowsByTable?.[`${opts.database}.${opts.table}`] ?? []) {
      yield batch
    }
  })

  const driver = {
    engine: options.engine ?? 'postgres',
    connectionId: options.connectionId,
    dialect: fakeDialect,
    listDatabases: async () => [],
    getDatabaseInfo: async () => fakeDatabaseInfo,
    listTables,
    getTableSchema,
    queryRows: async () => ({ rows: [], total: 0 }),
    insertRow: async () => ({ insertId: 0, affectedRows: 0 }),
    updateRow: async () => ({ affectedRows: 0 }),
    deleteRows: async () => ({ affectedRows: 0 }),
    renameTable: async () => ({ table: '' }),
    copyTable: async () => ({ table: '' }),
    dropDatabase: async () => undefined,
    dropTable: async () => undefined,
    executeSQL: async () => undefined,
    explainSQL: async () => ({ engine: 'postgres', statement: '', summary: [], plan: null, columns: [], rows: [] }),
    streamRows,
    testConnection: async () => 'OK',
    close: async () => undefined
  } satisfies DbDriver

  return { driver, listTables, getTableSchema, streamRows }
}

export function buildSchema(
  name: string,
  overrides?: {
    columns?: Array<{
      name: string
      type?: string
      nullable?: boolean
      defaultValue?: string | null
      isPrimaryKey?: boolean
      isAutoIncrement?: boolean
    }>
    indexes?: TableSchema['indexes']
  }
): TableSchema {
  const columns = (
    overrides?.columns ?? [
      {
        name: 'id',
        type: 'int',
        nullable: false,
        isPrimaryKey: true,
        isAutoIncrement: true
      }
    ]
  ).map((column) => ({
    name: column.name,
    type: column.type ?? 'int',
    nullable: column.nullable ?? false,
    defaultValue: column.defaultValue ?? null,
    isPrimaryKey: column.isPrimaryKey ?? false,
    isAutoIncrement: column.isAutoIncrement ?? false,
    comment: '',
    columnKey: column.isPrimaryKey ? 'PRI' : ''
  }))
  const indexes = overrides?.indexes ?? [
    { name: 'PRIMARY', columns: ['id'], unique: true, type: 'BTREE' }
  ]

  return {
    name,
    columns,
    indexes,
    primaryKey: columns.filter((column) => column.isPrimaryKey).map((column) => column.name),
    createSQL: `CREATE TABLE ${name} (...)`
  }
}