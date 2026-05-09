import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncRequest, TableSchema } from '../../shared/types'
import type { DbDriver, Dialect } from './drivers/types'

const { getDriver, getTableSchema } = vi.hoisted(() => ({
  getDriver: vi.fn(),
  getTableSchema: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

vi.mock('./db-service', () => ({
  dbService: {
    getDriver
  }
}))

vi.mock('./schema-service', () => ({
  schemaService: {
    getTableSchema
  }
}))

import { syncService } from './sync-service'

const syncDialect: Dialect = {
  engine: 'mysql',
  quoteIdent: (name) => `\`${name}\``,
  quoteTable: (database, table) => `\`${database}\`.\`${table}\``,
  formatLiteral: (value) => JSON.stringify(value),
  renderInsert: (database, table, _columns, rows) => `INSERT ${database}.${table} rows:${rows.length}`,
  renderTruncate: (database, table) => `TRUNCATE ${database}.${table}`,
  renderDropIfExists: (database, table) => `DROP ${database}.${table}`,
  stripDefiner: (sql) => sql
}

const pgSyncDialect: Dialect = {
  engine: 'postgres',
  quoteIdent: (name) => `"${name}"`,
  quoteTable: (database, table) => `"${database}"."${table}"`,
  formatLiteral: (value) => JSON.stringify(value),
  renderInsert: (database, table, _columns, rows) =>
    `INSERT INTO "${database}"."${table}" rows:${rows.length}`,
  renderTruncate: (database, table) => `TRUNCATE "${database}"."${table}"`,
  renderDropIfExists: (database, table) => `DROP "${database}"."${table}"`,
  stripDefiner: (sql) => sql
}

describe('SyncService', () => {
  beforeEach(() => {
    getDriver.mockReset()
    getTableSchema.mockReset()
  })

  it('builds a dry-run overwrite plan with preview inserts', async () => {
    const schema = buildSchema('users')
    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      tablesByDatabase: { source_db: ['users'] },
      streamBatches: [[{ id: 1 }]]
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      tablesByDatabase: { target_db: ['users'] }
    })

    mockDrivers(sourceDriver.driver, targetDriver.driver)
    getTableSchema.mockResolvedValue(schema)

    const plan = await syncService.buildPlan(createSyncRequest({ existingTableStrategy: 'overwrite-structure' }))

    expect(plan.steps).toEqual([
      {
        table: 'users',
        description: 'drop & recreate target table, data preview (50 rows)',
        sqls: ['DROP target_db.users', 'CREATE TABLE `target_db`.`users` (id int);', 'INSERT target_db.users rows:1']
      }
    ])
    expect(sourceDriver.streamRows).toHaveBeenCalledTimes(1)
    expect(targetDriver.executeSQL).not.toHaveBeenCalled()
  })

  it('skips existing target tables for skip strategy without previewing rows', async () => {
    const schema = buildSchema('users')
    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      tablesByDatabase: { source_db: ['users'] },
      streamBatches: [[{ id: 1 }]]
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      tablesByDatabase: { target_db: ['users'] }
    })

    mockDrivers(sourceDriver.driver, targetDriver.driver)
    getTableSchema.mockResolvedValue(schema)

    const plan = await syncService.buildPlan(createSyncRequest({ existingTableStrategy: 'skip' }))

    expect(plan.steps).toEqual([
      {
        table: 'users',
        description: 'skip existing table',
        sqls: []
      }
    ])
    expect(sourceDriver.streamRows).not.toHaveBeenCalled()
    expect(targetDriver.executeSQL).not.toHaveBeenCalled()
  })

  it('keeps target structure for append-data while still previewing inserts', async () => {
    const schema = buildSchema('users')
    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      tablesByDatabase: { source_db: ['users'] },
      streamBatches: [[{ id: 1 }]]
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      tablesByDatabase: { target_db: ['users'] }
    })

    mockDrivers(sourceDriver.driver, targetDriver.driver)
    getTableSchema.mockResolvedValue(schema)

    const plan = await syncService.buildPlan(createSyncRequest({ existingTableStrategy: 'append-data' }))

    expect(plan.steps).toEqual([
      {
        table: 'users',
        description: 'keep target structure, data preview (50 rows)',
        sqls: ['INSERT target_db.users rows:1']
      }
    ])
  })

  it('adds truncate before preview inserts for truncate-and-import', async () => {
    const schema = buildSchema('users')
    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      tablesByDatabase: { source_db: ['users'] },
      streamBatches: [[{ id: 1 }]]
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      tablesByDatabase: { target_db: ['users'] }
    })

    mockDrivers(sourceDriver.driver, targetDriver.driver)
    getTableSchema.mockResolvedValue(schema)

    const plan = await syncService.buildPlan(createSyncRequest({ existingTableStrategy: 'truncate-and-import' }))

    expect(plan.steps).toEqual([
      {
        table: 'users',
        description: 'keep target structure, data preview (50 rows)',
        sqls: ['TRUNCATE target_db.users', 'INSERT target_db.users rows:1']
      }
    ])
  })

  it('supports cross-engine data-only preview when target tables already exist', async () => {
    const schema = buildSchema('users')
    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      engine: 'mysql',
      dialect: syncDialect,
      tablesByDatabase: { source_db: ['users'] },
      streamBatches: [[{ id: 1 }]]
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      engine: 'postgres',
      dialect: pgSyncDialect,
      tablesByDatabase: { target_db: ['users'] }
    })

    mockDrivers(sourceDriver.driver, targetDriver.driver)
    getTableSchema.mockResolvedValue(schema)

    const plan = await syncService.buildPlan(
      createSyncRequest({
        syncStructure: false,
        existingTableStrategy: 'append-data'
      })
    )

    expect(plan.steps).toEqual([
      {
        table: 'users',
        description: 'data preview (50 rows)',
        sqls: ['INSERT INTO "public"."users" rows:1']
      }
    ])
  })

  it('builds cross-engine structure creation when target table is missing', async () => {
    const schema = buildSchema('users')
    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      engine: 'mysql',
      dialect: syncDialect,
      tablesByDatabase: { source_db: ['users'] },
      streamBatches: [[{ id: 1 }]]
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      engine: 'postgres',
      dialect: pgSyncDialect,
      tablesByDatabase: { target_db: [] }
    })

    mockDrivers(sourceDriver.driver, targetDriver.driver)
    getTableSchema.mockResolvedValue(schema)

    const plan = await syncService.buildPlan(createSyncRequest())

    expect(plan.steps).toEqual([
      {
        table: 'users',
        description: 'create table, data preview (50 rows)',
        sqls: [
          'CREATE TABLE "public"."users" (\n  "id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,\n  PRIMARY KEY ("id")\n);',
          'INSERT INTO "public"."users" rows:1'
        ]
      }
    ])
  })
})

function mockDrivers(sourceDriver: DbDriver, targetDriver: DbDriver): void {
  getDriver.mockImplementation(async (connectionId: string) => {
    return connectionId === 'source-conn' ? sourceDriver : targetDriver
  })
}

function createFakeDriver(options: {
  connectionId: string
  engine?: DbDriver['engine']
  dialect?: Dialect
  tablesByDatabase?: Record<string, string[]>
  streamBatches?: Record<string, unknown>[][]
}): {
  driver: DbDriver
  listTables: ReturnType<typeof vi.fn>
  streamRows: ReturnType<typeof vi.fn>
  executeSQL: ReturnType<typeof vi.fn>
} {
  const listTables = vi.fn(async (database: string) => {
    return options.tablesByDatabase?.[database] ?? []
  })
  const streamRows = vi.fn(async function* () {
    for (const batch of options.streamBatches ?? []) {
      yield batch
    }
  })
  const executeSQL = vi.fn(async () => undefined)

  const driver = {
    engine: options.engine ?? 'mysql',
    connectionId: options.connectionId,
    dialect: options.dialect ?? syncDialect,
    listDatabases: async () => [],
    getDatabaseInfo: async () => ({
      name: 'unused',
      tableCount: 0,
      rowEstimate: 0,
      dataLength: 0,
      indexLength: 0,
      totalSize: 0
    }),
    listTables,
    getTableSchema: async () => buildSchema('unused'),
    queryRows: async () => ({ rows: [], total: 0 }),
    insertRow: async () => ({ insertId: 0, affectedRows: 0 }),
    updateRow: async () => ({ affectedRows: 0 }),
    deleteRows: async () => ({ affectedRows: 0 }),
    renameTable: async () => ({ table: '' }),
    copyTable: async () => ({ table: '' }),
    dropDatabase: async () => undefined,
    dropTable: async () => undefined,
    executeSQL,
    explainSQL: async () => ({ engine: 'mysql', statement: '', summary: [], plan: null, columns: [], rows: [] }),
    streamRows,
    testConnection: async () => 'OK',
    close: async () => undefined
  } satisfies DbDriver

  return { driver, listTables, streamRows, executeSQL }
}

function buildSchema(name: string): TableSchema {
  return {
    name,
    columns: [
      {
        name: 'id',
        type: 'int',
        nullable: false,
        defaultValue: null,
        isPrimaryKey: true,
        isAutoIncrement: true,
        comment: '',
        columnKey: 'PRI'
      }
    ],
    indexes: [{ name: 'PRIMARY', columns: ['id'], unique: true, type: 'BTREE' }],
    primaryKey: ['id'],
    createSQL: `CREATE TABLE ${name} (id int)`
  }
}

function createSyncRequest(overrides?: Partial<SyncRequest>): SyncRequest {
  return {
    sourceConnectionId: 'source-conn',
    sourceDatabase: 'source_db',
    targetConnectionId: 'target-conn',
    targetDatabase: 'target_db',
    tables: ['users'],
    syncStructure: true,
    syncData: true,
    existingTableStrategy: 'overwrite-structure',
    dryRun: true,
    ...overrides
  }
}
