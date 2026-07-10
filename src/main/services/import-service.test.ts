import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportTableRequest, TableSchema } from '../../shared/types'
import type { DbDriver } from './drivers/types'

const { readFile, showOpenDialog, showMessageBox, getDriver, getTableSchema } = vi.hoisted(() => ({
  readFile: vi.fn(),
  showOpenDialog: vi.fn(),
  showMessageBox: vi.fn(),
  getDriver: vi.fn(),
  getTableSchema: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  readFile
}))

vi.mock('../platform/electron-runtime', () => ({
  isElectronRuntime: () => true,
  showOpenDialog,
  showMessageBox
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

import { importService } from './import-service'
import { mysqlDialect } from './drivers/mysql-dialect'
import { pgDialect } from './drivers/pg-dialect'

describe('ImportService', () => {
  beforeEach(() => {
    readFile.mockReset()
    showOpenDialog.mockReset()
    showMessageBox.mockReset()
    getDriver.mockReset()
    getTableSchema.mockReset()
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/users.csv'] })
    showMessageBox.mockResolvedValue({ response: 0 })
  })

  it('imports CSV rows into MySQL with header mapping', async () => {
    const { driver, executeSQL } = createDriver('mysql')
    getDriver.mockResolvedValue(driver)
    getTableSchema.mockResolvedValue(buildSchema())
    readFile.mockResolvedValue('id,name,note\n,Ada,"hello, csv"\n2,Bob,\n')

    const result = await importService.importTable(createImportRequest({ format: 'csv' }))

    expect(result).toEqual({
      canceled: false,
      filePath: '/tmp/users.csv',
      rowsImported: 2,
      statementsExecuted: 2
    })
    expect(executeSQL).toHaveBeenCalledWith(
      expect.stringContaining('START TRANSACTION;'),
      'shop'
    )
    const sql = String(executeSQL.mock.calls[0]?.[0] ?? '')
    expect(sql).toContain('INSERT INTO `shop`.`users` (`name`, `note`)')
    expect(sql).toContain("('Ada', 'hello, csv')")
    expect(sql).toContain('INSERT INTO `shop`.`users` (`id`, `name`, `note`)')
    expect(sql).toContain("('2', 'Bob', NULL)")
    expect(sql).toContain('COMMIT;')
  })

  it('imports renderer-provided file content without opening the file picker', async () => {
    const { driver, executeSQL } = createDriver('mysql')
    getDriver.mockResolvedValue(driver)
    getTableSchema.mockResolvedValue(buildSchema())

    const result = await importService.importTable(
      createImportRequest({
        format: 'csv',
        fileName: 'users.csv',
        fileContent: 'name,note\nAda,from renderer\n'
      })
    )

    expect(result).toEqual({
      canceled: false,
      filePath: 'users.csv',
      rowsImported: 1,
      statementsExecuted: 1
    })
    expect(showOpenDialog).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
    expect(executeSQL).toHaveBeenCalledWith(
      expect.stringContaining("('Ada', 'from renderer')"),
      'shop'
    )
  })

  it('imports tab-separated text into PostgreSQL without headers', async () => {
    const { driver, executeSQL } = createDriver('postgres')
    getDriver.mockResolvedValue(driver)
    getTableSchema.mockResolvedValue(buildSchema())
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/users.tsv'] })
    readFile.mockResolvedValue('1\tAda\tadmin\n2\tBob\tuser\n')

    const result = await importService.importTable(
      createImportRequest({
        connectionId: 'pg-conn',
        format: 'txt',
        includeHeaders: false,
        emptyAsNull: false
      })
    )

    expect(result.rowsImported).toBe(2)
    const sql = String(executeSQL.mock.calls[0]?.[0] ?? '')
    expect(sql).toContain('BEGIN;')
    expect(sql).toContain('INSERT INTO "public"."users"')
    expect(sql).toContain("('1', 'Ada', 'admin')")
    expect(sql).toContain("('2', 'Bob', 'user')")
    expect(sql).toContain('COMMIT;')
  })

  it('executes a selected SQL file against the chosen database', async () => {
    const { driver, executeSQL } = createDriver('postgres')
    const sql = "CREATE TABLE users (id int);\nINSERT INTO users VALUES ('semi;colon');"
    getDriver.mockResolvedValue(driver)
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/users.sql'] })
    readFile.mockResolvedValue(sql)

    const result = await importService.importTable(
      createImportRequest({ connectionId: 'pg-conn', format: 'sql' })
    )

    expect(result).toEqual({
      canceled: false,
      filePath: '/tmp/users.sql',
      rowsImported: 0,
      statementsExecuted: 2
    })
    expect(executeSQL).toHaveBeenCalledWith(sql, 'shop')
    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Execute this SQL file against shop?',
        detail: '/tmp/users.sql'
      })
    )
    expect(getTableSchema).not.toHaveBeenCalled()
  })

  it('cancels SQL import after file selection when confirmation is rejected', async () => {
    const { driver, executeSQL } = createDriver('postgres')
    getDriver.mockResolvedValue(driver)
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/users.sql'] })
    showMessageBox.mockResolvedValue({ response: 1 })

    const result = await importService.importTable(
      createImportRequest({ connectionId: 'pg-conn', format: 'sql' })
    )

    expect(result).toEqual({ canceled: true, rowsImported: 0, statementsExecuted: 0 })
    expect(readFile).not.toHaveBeenCalled()
    expect(executeSQL).not.toHaveBeenCalled()
  })

  it('returns canceled when the file picker is canceled', async () => {
    const { driver, executeSQL } = createDriver('mysql')
    getDriver.mockResolvedValue(driver)
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    const result = await importService.importTable(createImportRequest({ format: 'csv' }))

    expect(result).toEqual({ canceled: true, rowsImported: 0, statementsExecuted: 0 })
    expect(readFile).not.toHaveBeenCalled()
    expect(executeSQL).not.toHaveBeenCalled()
  })

  it('rejects header columns that are missing from the target table', async () => {
    const { driver } = createDriver('mysql')
    getDriver.mockResolvedValue(driver)
    getTableSchema.mockResolvedValue(buildSchema())
    readFile.mockResolvedValue('missing\nvalue\n')

    await expect(importService.importTable(createImportRequest({ format: 'csv' }))).rejects.toThrow(
      'Column "missing" does not exist in target table'
    )
  })

  it('executes delimited imports as one transaction', async () => {
    const { driver, executeSQL } = createDriver('mysql')
    executeSQL.mockRejectedValue(new Error('duplicate key'))
    getDriver.mockResolvedValue(driver)
    getTableSchema.mockResolvedValue(buildSchema())
    readFile.mockResolvedValue('name,note\nAda,ok\nBob,duplicate\n')

    await expect(importService.importTable(createImportRequest({ format: 'csv' }))).rejects.toThrow(
      'duplicate key'
    )
    expect(executeSQL).toHaveBeenCalledTimes(1)
    const sql = String(executeSQL.mock.calls[0]?.[0] ?? '')
    expect(sql.startsWith('START TRANSACTION;')).toBe(true)
    expect(sql).toContain("('Ada', 'ok')")
    expect(sql).toContain("('Bob', 'duplicate')")
    expect(sql.trim().endsWith('COMMIT;')).toBe(true)
  })

  it('validates all delimited rows before writing any row', async () => {
    const { driver, executeSQL } = createDriver('mysql')
    getDriver.mockResolvedValue(driver)
    getTableSchema.mockResolvedValue(buildSchema())
    readFile.mockResolvedValue('name,note\nAda,ok\nBob,ok,extra\n')

    await expect(importService.importTable(createImportRequest({ format: 'csv' }))).rejects.toThrow(
      'Line 3 has more cells than import columns'
    )
    expect(executeSQL).not.toHaveBeenCalled()
  })

  it('rejects short delimited rows before writing any row', async () => {
    const { driver, executeSQL } = createDriver('mysql')
    getDriver.mockResolvedValue(driver)
    getTableSchema.mockResolvedValue(buildSchema())
    readFile.mockResolvedValue('name,note\nAda,ok\nBob\n')

    await expect(importService.importTable(createImportRequest({ format: 'csv' }))).rejects.toThrow(
      'Line 3 has fewer cells than import columns'
    )
    expect(executeSQL).not.toHaveBeenCalled()
  })
})

function createDriver(engine: 'mysql' | 'postgres'): {
  driver: DbDriver
  insertRow: ReturnType<typeof vi.fn>
  executeSQL: ReturnType<typeof vi.fn>
} {
  const insertRow = vi.fn(async () => ({ insertId: 0, affectedRows: 1 }))
  const executeSQL = vi.fn(async () => undefined)

  const driver = {
    engine,
    connectionId: engine === 'postgres' ? 'pg-conn' : 'mysql-conn',
    dialect: engine === 'postgres' ? pgDialect : mysqlDialect,
    listDatabases: async () => [],
    getDatabaseInfo: async () => ({
      name: 'unused',
      tableCount: 0,
      rowEstimate: 0,
      dataLength: 0,
      indexLength: 0,
      totalSize: 0
    }),
    listTables: async () => [],
    getTableSchema: async () => buildSchema(),
    queryRows: async () => ({ rows: [], total: 0 }),
    insertRow,
    updateRow: async () => ({ affectedRows: 0 }),
    deleteRows: async () => ({ affectedRows: 0 }),
    renameTable: async () => ({ table: '' }),
    copyTable: async () => ({ table: '' }),
    dropDatabase: async () => undefined,
    dropTable: async () => undefined,
    executeSQL,
    explainSQL: async () => ({ engine, statement: '', summary: [], plan: null, columns: [], rows: [] }),
    streamRows: vi.fn(async function* () {
      yield []
    }),
    testConnection: async () => 'OK',
    close: async () => undefined
  } satisfies DbDriver

  return { driver, insertRow, executeSQL }
}

function buildSchema(): TableSchema {
  return {
    name: 'users',
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
      },
      {
        name: 'name',
        type: 'varchar(255)',
        nullable: false,
        defaultValue: null,
        isPrimaryKey: false,
        isAutoIncrement: false,
        comment: '',
        columnKey: ''
      },
      {
        name: 'note',
        type: 'text',
        nullable: true,
        defaultValue: null,
        isPrimaryKey: false,
        isAutoIncrement: false,
        comment: '',
        columnKey: ''
      }
    ],
    indexes: [{ name: 'PRIMARY', columns: ['id'], unique: true, type: 'BTREE' }],
    primaryKey: ['id'],
    createSQL: 'CREATE TABLE users (id int, name varchar(255), note text)'
  }
}

function createImportRequest(overrides?: Partial<ImportTableRequest>): ImportTableRequest {
  return {
    connectionId: 'mysql-conn',
    database: 'shop',
    table: 'users',
    format: 'csv',
    includeHeaders: true,
    emptyAsNull: true,
    ...overrides
  }
}
