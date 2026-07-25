import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionConfig } from '../../../shared/types'

const { createPool, createConnection } = vi.hoisted(() => ({
  createPool: vi.fn(),
  createConnection: vi.fn()
}))

vi.mock('mysql2/promise', () => ({
  default: {
    createPool,
    createConnection
  },
  createPool,
  createConnection
}))

import { MySQLDriver } from './mysql-driver'

describe('MySQLDriver', () => {
  beforeEach(() => {
    createPool.mockReset()
    createConnection.mockReset()
    createConnection.mockResolvedValue({
      query: vi.fn(async () => [[]]),
      end: vi.fn(async () => undefined)
    })
  })

  it('reuses one pool per database without issuing USE statements', async () => {
    const poolA = createPoolDouble([[{ TABLE_NAME: 'users' }]])
    const poolB = createPoolDouble([[{ TABLE_NAME: 'orders' }]])

    createPool.mockImplementation((options?: { database?: string }) => {
      if (options?.database === 'db_a') return poolA.pool
      if (options?.database === 'db_b') return poolB.pool
      throw new Error(`Unexpected database ${options?.database}`)
    })

    const driver = new MySQLDriver({ connection: createConnectionConfig() })

    await driver.listTables('db_a')
    await driver.listTables('db_a')
    await driver.listTables('db_b')

    expect(createPool).toHaveBeenCalledTimes(2)
    expect(createPool.mock.calls[0]?.[0]).toMatchObject({ database: 'db_a', connectionLimit: 5 })
    expect(createPool.mock.calls[1]?.[0]).toMatchObject({ database: 'db_b', connectionLimit: 5 })

    const executedSql = [...poolA.query.mock.calls, ...poolB.query.mock.calls].map((call) => String(call[0]))
    expect(executedSql.some((sql) => sql.startsWith('USE '))).toBe(false)

    expect(driver.getPoolDebugSnapshot()).toMatchObject({
      cachedPools: 2,
      maxCachedPools: 8,
      stats: {
        createdPools: 2,
        reusedPools: 1,
        evictedPools: 0,
        skippedEvictions: 0
      },
      entries: [
        { database: 'db_a', activeUsers: 0 },
        { database: 'db_b', activeUsers: 0 }
      ]
    })
  })

  it('allows concurrent requests across different databases on the same driver', async () => {
    let resolveA: ((value: unknown) => void) | undefined
    let resolveB: ((value: unknown) => void) | undefined
    let markQueryAStarted: (() => void) | undefined
    let markQueryBStarted: (() => void) | undefined
    const queryAStarted = new Promise<void>((resolve) => {
      markQueryAStarted = resolve
    })
    const queryBStarted = new Promise<void>((resolve) => {
      markQueryBStarted = resolve
    })
    const poolA = createPoolDouble(
      new Promise((resolve) => {
        resolveA = resolve
      }),
      () => markQueryAStarted?.()
    )
    const poolB = createPoolDouble(
      new Promise((resolve) => {
        resolveB = resolve
      }),
      () => markQueryBStarted?.()
    )

    createPool.mockImplementation((options?: { database?: string }) => {
      if (options?.database === 'db_a') return poolA.pool
      if (options?.database === 'db_b') return poolB.pool
      throw new Error(`Unexpected database ${options?.database}`)
    })

    const driver = new MySQLDriver({ connection: createConnectionConfig() })
    const pending = Promise.all([driver.listTables('db_a'), driver.listTables('db_b')])

    await Promise.all([queryAStarted, queryBStarted])

    expect(poolA.query).toHaveBeenCalledTimes(1)
    expect(poolB.query).toHaveBeenCalledTimes(1)

    resolveA?.([[{ TABLE_NAME: 'users' }]])
    resolveB?.([[{ TABLE_NAME: 'orders' }]])

    await expect(pending).resolves.toEqual([['users'], ['orders']])
  })

  it('reuses a single pool when the same database is first opened concurrently', async () => {
    let resolveQuery: ((value: unknown) => void) | undefined
    let markQueryStarted: (() => void) | undefined
    const queryStarted = new Promise<void>((resolve) => {
      markQueryStarted = resolve
    })
    const poolA = createPoolDouble(
      new Promise((resolve) => {
        resolveQuery = resolve
      }),
      () => markQueryStarted?.()
    )

    createPool.mockImplementation((options?: { database?: string }) => {
      if (options?.database === 'db_a') return poolA.pool
      throw new Error(`Unexpected database ${options?.database}`)
    })

    const driver = new MySQLDriver({ connection: createConnectionConfig() })
    const pending = Promise.all([driver.listTables('db_a'), driver.listTables('db_a')])

    await queryStarted

    expect(createPool).toHaveBeenCalledTimes(1)
    expect(driver.getPoolDebugSnapshot()).toMatchObject({
      cachedPools: 1,
      stats: {
        createdPools: 1,
        reusedPools: 1,
        evictedPools: 0,
        skippedEvictions: 0
      },
      entries: [{ database: 'db_a', activeUsers: 2 }]
    })

    resolveQuery?.([[{ TABLE_NAME: 'users' }]])

    await expect(pending).resolves.toEqual([['users'], ['users']])
    expect(driver.getPoolDebugSnapshot().entries).toEqual([{ database: 'db_a', activeUsers: 0 }])
  })

  it('does not evict a pool while it still has an active operation', async () => {
    let resolveActiveQuery: ((value: unknown) => void) | undefined
    let markActiveQueryStarted: (() => void) | undefined
    const activeQueryStarted = new Promise<void>((resolve) => {
      markActiveQueryStarted = resolve
    })
    const pools = new Map<string, ReturnType<typeof createPoolDouble>>()

    createPool.mockImplementation((options?: { database?: string }) => {
      const database = options?.database ?? '__default__'
      const existing = pools.get(database)
      if (existing) return existing.pool

      const poolDouble = database === 'db_1'
        ? createPoolDouble(
            new Promise((resolve) => {
              resolveActiveQuery = resolve
            }),
            () => markActiveQueryStarted?.()
          )
        : createPoolDouble([[{ TABLE_NAME: database }]])
      pools.set(database, poolDouble)
      return poolDouble.pool
    })

    const driver = new MySQLDriver({ connection: createConnectionConfig() })
    const pending = driver.listTables('db_1')

    await activeQueryStarted

    for (let index = 2; index <= 8; index += 1) {
      await driver.listTables(`db_${index}`)
    }

    await driver.listTables('db_9')

    expect(pools.get('db_1')?.end).not.toHaveBeenCalled()
    expect(pools.get('db_2')?.end).toHaveBeenCalledTimes(1)

    resolveActiveQuery?.([[{ TABLE_NAME: 'users' }]])
    await expect(pending).resolves.toEqual(['users'])

    await driver.listTables('db_10')
    expect(pools.get('db_1')?.end).toHaveBeenCalledTimes(1)
  })

  it('does not evict a pool while a transaction connection is still active', async () => {
    let resolveBeginTransaction: (() => void) | undefined
    let markBeginStarted: (() => void) | undefined
    const beginStarted = new Promise<void>((resolve) => {
      markBeginStarted = resolve
    })
    const pools = new Map<string, ReturnType<typeof createPoolDouble>>()
    const connection = {
      beginTransaction: vi.fn(async () => {
        markBeginStarted?.()
        await new Promise<void>((resolve) => {
          resolveBeginTransaction = resolve
        })
      }),
      execute: vi.fn(async () => [{ affectedRows: 1 }]),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      release: vi.fn()
    }

    createPool.mockImplementation((options?: { database?: string }) => {
      const database = options?.database ?? '__default__'
      const existing = pools.get(database)
      if (existing) return existing.pool

      const poolDouble = database === 'db_1'
        ? createPoolDouble([[{ TABLE_NAME: 'users' }]], undefined, vi.fn(async () => connection))
        : createPoolDouble([[{ TABLE_NAME: database }]])
      pools.set(database, poolDouble)
      return poolDouble.pool
    })

    const driver = new MySQLDriver({ connection: createConnectionConfig() })
    const pending = driver.deleteRows({
      connectionId: 'conn-id',
      database: 'db_1',
      table: 'users',
      pkRows: [{ id: 1 }]
    })

    await beginStarted

    for (let index = 2; index <= 8; index += 1) {
      await driver.listTables(`db_${index}`)
    }

    await driver.listTables('db_9')

    expect(pools.get('db_1')?.end).not.toHaveBeenCalled()
    expect(pools.get('db_2')?.end).toHaveBeenCalledTimes(1)
    expect(driver.getPoolDebugSnapshot().entries.find((entry) => entry.database === 'db_1')).toEqual({
      database: 'db_1',
      activeUsers: 1
    })

    resolveBeginTransaction?.()
    await expect(pending).resolves.toEqual({ affectedRows: 1 })
    expect(connection.release).toHaveBeenCalledTimes(1)

    await driver.listTables('db_10')
    expect(pools.get('db_1')?.end).toHaveBeenCalledTimes(1)
  })

  it('evicts the least recently used pool when the cache grows past the limit', async () => {
    const pools = new Map<string, ReturnType<typeof createPoolDouble>>()

    createPool.mockImplementation((options?: { database?: string }) => {
      const database = options?.database ?? '__default__'
      const existing = pools.get(database)
      if (existing) return existing.pool

      const poolDouble = createPoolDouble([[{ TABLE_NAME: database }]])
      pools.set(database, poolDouble)
      return poolDouble.pool
    })

    const driver = new MySQLDriver({ connection: createConnectionConfig() })

    for (let index = 1; index <= 8; index += 1) {
      await driver.listTables(`db_${index}`)
    }

    await driver.listTables('db_1')
    await driver.listTables('db_9')

    expect(pools.get('db_2')?.end).toHaveBeenCalledTimes(1)
    expect(pools.get('db_1')?.end).not.toHaveBeenCalled()
    expect(pools.get('db_9')?.end).not.toHaveBeenCalled()
    expect(driver.getPoolDebugSnapshot()).toMatchObject({
      cachedPools: 8,
      stats: {
        createdPools: 9,
        reusedPools: 1,
        evictedPools: 1,
        skippedEvictions: 0
      }
    })
  })

  it('keeps the cache at the limit when different new databases open concurrently', async () => {
    const pools = new Map<string, ReturnType<typeof createPoolDouble>>()

    createPool.mockImplementation((options?: { database?: string }) => {
      const database = options?.database ?? '__default__'
      const existing = pools.get(database)
      if (existing) return existing.pool

      const poolDouble = createPoolDouble([[{ TABLE_NAME: database }]])
      pools.set(database, poolDouble)
      return poolDouble.pool
    })

    const driver = new MySQLDriver({ connection: createConnectionConfig() })

    for (let index = 1; index <= 8; index += 1) {
      await driver.listTables(`db_${index}`)
    }

    await Promise.all([driver.listTables('db_9'), driver.listTables('db_10')])

    expect(driver.getPoolDebugSnapshot()).toMatchObject({
      cachedPools: 8,
      stats: {
        createdPools: 10,
        reusedPools: 0,
        evictedPools: 2,
        skippedEvictions: 0
      }
    })
    expect(pools.get('db_1')?.end).toHaveBeenCalledTimes(1)
    expect(pools.get('db_2')?.end).toHaveBeenCalledTimes(1)
  })

  it('closes all cached pools on close', async () => {
    const poolA = createPoolDouble([[{ TABLE_NAME: 'users' }]])
    const poolB = createPoolDouble([[{ TABLE_NAME: 'orders' }]])

    createPool.mockImplementation((options?: { database?: string }) => {
      if (options?.database === 'db_a') return poolA.pool
      if (options?.database === 'db_b') return poolB.pool
      throw new Error(`Unexpected database ${options?.database}`)
    })

    const driver = new MySQLDriver({ connection: createConnectionConfig() })

    await driver.listTables('db_a')
    await driver.listTables('db_b')
    await driver.close()

    expect(poolA.end).toHaveBeenCalledTimes(1)
    expect(poolB.end).toHaveBeenCalledTimes(1)
  })

  it('uses an exact count instead of the InnoDB row estimate for table info', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('information_schema.COLUMNS')) {
        return [[{
          COLUMN_NAME: 'id',
          COLUMN_TYPE: 'bigint',
          IS_NULLABLE: 'NO',
          COLUMN_DEFAULT: null,
          COLUMN_KEY: 'PRI',
          EXTRA: 'auto_increment',
          COLUMN_COMMENT: ''
        }]]
      }
      if (sql.includes('information_schema.STATISTICS')) {
        return [[{
          INDEX_NAME: 'PRIMARY',
          NON_UNIQUE: 0,
          INDEX_TYPE: 'BTREE',
          COLUMN_NAME: 'id',
          SEQ_IN_INDEX: 1
        }]]
      }
      if (sql.startsWith('SHOW CREATE TABLE')) {
        return [[{ 'Create Table': 'CREATE TABLE `users` (`id` bigint)' }]]
      }
      if (sql.startsWith('SELECT COUNT(*) AS ROW_COUNT')) {
        return [[{ ROW_COUNT: 1 }]]
      }
      if (sql.includes('information_schema.TABLES')) {
        return [[{
          TABLE_ROWS: 0,
          ENGINE: 'InnoDB',
          TABLE_COLLATION: 'utf8mb4_unicode_ci',
          TABLE_COMMENT: '',
          DATA_LENGTH: 16384,
          INDEX_LENGTH: 32768,
          DATA_FREE: 0,
          AVG_ROW_LENGTH: 0,
          AUTO_INCREMENT: 2,
          CREATE_TIME: '2026-03-30 12:42:59',
          UPDATE_TIME: null
        }]]
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })
    createPool.mockReturnValue({
      query,
      execute: vi.fn(async () => [undefined]),
      getConnection: vi.fn(),
      end: vi.fn(async () => undefined)
    })

    const driver = new MySQLDriver({ connection: createConnectionConfig() })
    const result = await driver.getTableSchema('rpg', 'users')

    expect(result.rowEstimate).toBe(1)
    expect(query).toHaveBeenCalledWith('SELECT COUNT(*) AS ROW_COUNT FROM `rpg`.`users`')
  })
})

function createPoolDouble(queryResult: unknown, onQuery?: () => void, getConnection?: ReturnType<typeof vi.fn>) {
  const query = vi.fn(async (_sql: string) => {
    onQuery?.()
    return queryResult
  })
  const end = vi.fn(async () => undefined)

  return {
    query,
    end,
    pool: {
      query,
      execute: vi.fn(async () => [undefined]),
      getConnection: getConnection ?? vi.fn(),
      end
    }
  }
}

function createConnectionConfig(): ConnectionConfig {
  return {
    id: 'conn-id',
    engine: 'mysql',
    name: 'MySQL',
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    password: 'secret',
    useSSH: false,
    createdAt: 0,
    updatedAt: 0
  }
}
