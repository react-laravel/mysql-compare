import { describe, expect, it } from 'vitest'
import { createMockApi } from './dev-mock-api'
import { REDIS_MAX_LISTED_KEYS } from '../../shared/constants'
import type { IPCResult } from '../../shared/types'

function data<T>(result: IPCResult<T>): T {
  expect(result.ok, result.error).toBe(true)
  return result.data as T
}

describe('dev-mock-api', () => {
  const api = createMockApi('normal')

  it('exposes one connection per engine, including an SSH and a credential-scoped one', async () => {
    const connections = data(await api.connection.list())
    expect(connections.map((c) => c.engine).sort()).toEqual(['mysql', 'mysql', 'postgres', 'redis'])
    expect(connections.some((c) => c.useSSH)).toBe(true)
    expect(connections.some((c) => c.databaseCredentials?.analytics?.hasPassword)).toBe(true)
  })

  it('walks connection → database → table → rows', async () => {
    const [connection] = data(await api.connection.list())
    expect(connection).toBeDefined()
    const databases = data(await api.db.listDatabases(connection!.id))
    expect(databases).toContain('shop')
    const tables = data(await api.db.listTables(connection!.id, 'shop'))
    expect(tables).toContain('users')

    const page = data(
      await api.db.queryRows({
        connectionId: connection!.id,
        database: 'shop',
        table: 'users',
        page: 1,
        pageSize: 25
      })
    )
    expect(page.rows).toHaveLength(25)
    expect(page.total).toBeGreaterThan(25)
    expect(page.hasPrimaryKey).toBe(true)
    expect(page.columns.map((c) => c.name)).toContain('email')
  })

  it('is deterministic across instances', async () => {
    const req = {
      connectionId: 'mock-mysql',
      database: 'shop',
      table: 'orders',
      page: 3,
      pageSize: 10
    }
    const first = data(await api.db.queryRows(req))
    const second = data(await createMockApi('normal').db.queryRows(req))
    expect(second.rows).toEqual(first.rows)
  })

  it('pages and sorts', async () => {
    const base = { connectionId: 'mock-mysql', database: 'shop', table: 'orders', pageSize: 5 }
    const page1 = data(await api.db.queryRows({ ...base, page: 1 }))
    const page2 = data(await api.db.queryRows({ ...base, page: 2 }))
    expect(page2.rows[0]).not.toEqual(page1.rows[0])

    const desc = data(
      await api.db.queryRows({ ...base, page: 1, orderBy: { column: 'id', dir: 'DESC' } })
    )
    expect(desc.rows[0]?.id).toBe(page1.total)
  })

  it('serves a table without a primary key', async () => {
    const result = data(
      await api.db.queryRows({
        connectionId: 'mock-mysql',
        database: 'shop',
        table: 'v_feature_flags',
        page: 1,
        pageSize: 25
      })
    )
    expect(result.hasPrimaryKey).toBe(false)
    expect(result.primaryKey).toEqual([])
  })

  it('serves redis keys as field/value rows and reports a truncated key list', async () => {
    const keys = data(await api.db.listTables('mock-redis', 'db1'))
    const info = data(await api.db.getDatabaseInfo('mock-redis', 'db1'))
    expect(keys).toHaveLength(REDIS_MAX_LISTED_KEYS)
    expect(info.tableCount).toBeGreaterThan(keys.length)

    const result = data(
      await api.db.queryRows({
        connectionId: 'mock-redis',
        database: 'db0',
        table: data(await api.db.listTables('mock-redis', 'db0'))[0]!,
        page: 1,
        pageSize: 25
      })
    )
    expect(result.columns.map((c) => c.name)).toEqual(['field', 'value'])
  })

  it('returns a schema whose createSQL matches the engine', async () => {
    const mysql = data(await api.schema.getTable('mock-mysql', 'shop', 'users'))
    expect(mysql.primaryKey).toEqual(['id'])
    expect(mysql.createSQL).toContain('CREATE TABLE `users`')
    expect(mysql.indexes[0]?.name).toBe('PRIMARY')

    const postgres = data(await api.schema.getTable('mock-postgres', 'analytics', 'events'))
    expect(postgres.createSQL).toContain('CREATE TABLE "events"')
  })

  it('runs SQL: selects return rows, mutations return affectedRows', async () => {
    const rows = data(await api.db.executeSQL('mock-mysql', 'SELECT * FROM products LIMIT 4', 'shop'))
    expect(Array.isArray(rows)).toBe(true)
    expect(rows as unknown[]).toHaveLength(4)

    const mutation = data(await api.db.executeSQL('mock-mysql', 'UPDATE products SET stock = 0', 'shop'))
    expect(mutation).toHaveProperty('affectedRows')

    const explain = data(
      await api.db.explainSQL({ connectionId: 'mock-mysql', database: 'shop', sql: 'SELECT * FROM users' })
    )
    expect(explain.engine).toBe('mysql')
    expect(explain.plan).not.toBeNull()
  })

  it('diffs two databases into all three diff kinds', async () => {
    const diff = data(
      await api.diff.databases({
        sourceConnectionId: 'mock-mysql',
        sourceDatabase: 'shop',
        targetConnectionId: 'mock-mysql-ssh',
        targetDatabase: 'shop_staging',
        includeData: true
      })
    )
    const kinds = new Set(diff.tableDiffs.map((d) => d.kind))
    expect(kinds).toEqual(new Set(['only-in-source', 'only-in-target', 'modified']))
    expect(diff.rowComparisons.length).toBeGreaterThan(0)
    expect(diff.tableDiffs.find((d) => d.kind === 'modified')?.columnDiffs.length).toBeGreaterThan(0)
  })

  it('keeps every row-diff bucket internally consistent', async () => {
    // `ComparisonStatusPanel` prints these verbatim, so a small table (
    // `feature_flags` has 3 rows) must not report more differing rows than it
    // has and land a negative "identical" count on screen.
    const diff = data(
      await api.diff.databases({
        sourceConnectionId: 'mock-mysql',
        sourceDatabase: 'shop',
        targetConnectionId: 'mock-mysql-ssh',
        targetDatabase: 'shop_staging',
        includeData: true
      })
    )
    expect(diff.rowComparisons.some((c) => c.table === 'feature_flags')).toBe(true)
    for (const { table, dataDiff } of diff.rowComparisons) {
      if (!dataDiff.comparable) continue
      const label = `${table}: ${JSON.stringify(dataDiff)}`
      expect(dataDiff.identical, label).toBeGreaterThanOrEqual(0)
      expect(dataDiff.sourceOnly, label).toBeGreaterThanOrEqual(0)
      expect(dataDiff.targetOnly, label).toBeGreaterThanOrEqual(0)
      expect(dataDiff.modified, label).toBeGreaterThanOrEqual(0)
      expect(dataDiff.sourceOnly + dataDiff.modified + dataDiff.identical, label).toBe(
        dataDiff.sourceRowCount
      )
      expect(dataDiff.targetOnly + dataDiff.modified + dataDiff.identical, label).toBe(
        dataDiff.targetRowCount
      )
      expect(dataDiff.samples.length, label).toBeGreaterThan(0)
    }
  })

  it('builds a sync plan and streams progress while executing', async () => {
    const plan = data(
      await api.sync.buildPlan({
        sourceConnectionId: 'mock-mysql',
        sourceDatabase: 'shop',
        targetConnectionId: 'mock-mysql-ssh',
        targetDatabase: 'shop_staging',
        tables: ['users', 'orders'],
        syncStructure: true,
        syncData: true,
        existingTableStrategy: 'overwrite-structure',
        dryRun: true
      })
    )
    expect(plan.steps.map((s) => s.table)).toEqual(['users', 'orders'])

    const events: string[] = []
    const off = api.sync.onProgress((event) => events.push(event.step))
    const result = data(
      await api.sync.execute({
        sourceConnectionId: 'mock-mysql',
        sourceDatabase: 'shop',
        targetConnectionId: 'mock-mysql-ssh',
        targetDatabase: 'shop_staging',
        tables: ['users', 'orders'],
        syncStructure: true,
        syncData: true,
        existingTableStrategy: 'overwrite-structure',
        dryRun: false
      })
    )
    off()
    expect(result.executed).toBe(2)
    expect(events).toContain('structure')
    expect(events).toContain('done')
  })

  it('browses and mutates the SSH filesystem', async () => {
    const listing = data(await api.ssh.listFiles({ connectionId: 'mock-mysql-ssh' }))
    expect(listing.path).toBe('/home/deploy')
    expect(listing.parentPath).toBe('/home')
    expect(listing.entries.some((e) => e.type === 'symlink')).toBe(true)

    data(await api.ssh.createDirectory({ connectionId: 'mock-mysql-ssh', remoteDir: '/home/deploy', name: 'tmpdir' }))
    const afterCreate = data(await api.ssh.listFiles({ connectionId: 'mock-mysql-ssh', path: '/home/deploy' }))
    expect(afterCreate.entries.some((e) => e.name === 'tmpdir')).toBe(true)

    data(await api.ssh.deleteFile({ connectionId: 'mock-mysql-ssh', remotePath: '/home/deploy/tmpdir', type: 'directory' }))
    const afterDelete = data(await api.ssh.listFiles({ connectionId: 'mock-mysql-ssh', path: '/home/deploy' }))
    expect(afterDelete.entries.some((e) => e.name === 'tmpdir')).toBe(false)
  })

  it('round-trips an SSH file edit', async () => {
    const path = '/home/deploy/notes.md'
    data(await api.ssh.writeFile({ connectionId: 'mock-mysql-ssh', remotePath: path, content: 'edited' }))
    const read = data(await api.ssh.readFile({ connectionId: 'mock-mysql-ssh', remotePath: path }))
    expect(read.content).toBe('edited')
  })

  it('streams a terminal banner and echoes typed input', async () => {
    const chunks: string[] = []
    const off = api.ssh.onTerminalData((event) => chunks.push(event.data))
    const session = data(await api.ssh.createTerminal({ connectionId: 'mock-mysql-ssh' }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(chunks.join('')).toContain('mock session')

    chunks.length = 0
    data(await api.ssh.writeTerminal({ sessionId: session.sessionId, data: 'pwd\r' }))
    expect(chunks.join('')).toContain('/home/deploy')

    let exited = false
    const offExit = api.ssh.onTerminalExit(() => {
      exited = true
    })
    data(await api.ssh.closeTerminal({ sessionId: session.sessionId }))
    expect(exited).toBe(true)
    off()
    offExit()
  })

  it('mutates the tree on rename, copy and drop', async () => {
    const local = createMockApi('normal')
    data(await local.db.renameTable({ connectionId: 'mock-mysql', database: 'shop', table: 'products', newTable: 'items' }))
    expect(data(await local.db.listTables('mock-mysql', 'shop'))).toContain('items')

    data(await local.db.copyTable({ connectionId: 'mock-mysql', database: 'shop', table: 'items', targetTable: 'items_copy' }))
    expect(data(await local.db.listTables('mock-mysql', 'shop'))).toContain('items_copy')

    data(await local.db.dropTable({ connectionId: 'mock-mysql', database: 'shop', table: 'items_copy' }))
    expect(data(await local.db.listTables('mock-mysql', 'shop'))).not.toContain('items_copy')
  })

  describe('?mock=error', () => {
    const failing = createMockApi('error')

    it('still lists connections so the sidebar is navigable', async () => {
      expect((await failing.connection.list()).ok).toBe(true)
    })

    it('fails every other read with an error envelope', async () => {
      const result = await failing.db.listDatabases('mock-mysql')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('mock=error')
    })

    it('reports a failed table during sync instead of silently succeeding', async () => {
      const levels: string[] = []
      const off = failing.sync.onProgress((event) => levels.push(event.level))
      const result = await failing.sync.execute({
        sourceConnectionId: 'mock-mysql',
        sourceDatabase: 'shop',
        targetConnectionId: 'mock-mysql-ssh',
        targetDatabase: 'shop_staging',
        tables: ['users', 'orders'],
        syncStructure: true,
        syncData: true,
        existingTableStrategy: 'overwrite-structure',
        dryRun: false
      })
      off()
      expect(levels).toContain('error')
      expect(result.data?.errors).toBeGreaterThan(0)
    })
  })
})
