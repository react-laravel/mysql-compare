// 同步：根据 SyncRequest 生成 SQL 计划，可 dry-run（仅返回 SQL）或真实执行。
// 所有方言相关的 DDL / 字面量格式化都委托给目标 driver 的 Dialect。
// 表顺序按源库外键拓扑排序（被引用表优先）；MySQL 目标额外关闭 FOREIGN_KEY_CHECKS。
import type {
  SyncPlan,
  SyncProgressEvent,
  SyncRequest,
  SyncStep,
  TableSchema
} from '../../shared/types'
import { dbService } from './db-service'
import type { DbDriver } from './drivers/types'
import { buildCreateTableSQL } from './export-service'
import { orderTablesByForeignKeys, type ForeignKeyEdge } from './fk-order'
import { schemaService } from './schema-service'

const PREVIEW_ROW_LIMIT = 50
const INSERT_BATCH_SIZE = 200

interface PreparedTableSync {
  table: string
  description: string
  schema: TableSchema
  setupSQLs: string[]
  dataRowLimit?: number
  skip: boolean
}

interface SyncContext {
  sourceDriver: DbDriver
  targetDriver: DbDriver
  sourceTables: Set<string>
  targetTables: Set<string>
  crossEngine: boolean
  orderedTables: string[]
}

interface ExecuteSyncOptions {
  onProgress?: (event: SyncProgressEvent) => void
}

export class SyncService {
  /** 生成同步计划（不执行） */
  async buildPlan(req: SyncRequest): Promise<SyncPlan> {
    const steps: SyncStep[] = []
    const context = await this.loadSyncContext(req)

    for (const sql of this.buildForeignKeyGuardSQLs(context.targetDriver, 'begin')) {
      steps.push({
        table: '*',
        description: 'disable foreign key checks',
        sqls: [sql]
      })
    }

    const truncateSQL = this.buildBatchTruncateSQL(req, context)
    if (truncateSQL) {
      steps.push({
        table: '*',
        description: 'truncate selected tables (FK-safe batch)',
        sqls: [truncateSQL]
      })
    }

    for (const table of context.orderedTables) {
      const prepared = await this.prepareTableSync(table, req, context, true, Boolean(truncateSQL))
      const sqls = [...prepared.setupSQLs]

      if (!prepared.skip && req.syncData) {
        for await (const sql of this.generateInsertStatements(prepared, req, context)) {
          sqls.push(sql)
        }
      }

      steps.push({ table, description: prepared.description, sqls })
    }

    for (const sql of this.buildForeignKeyGuardSQLs(context.targetDriver, 'end')) {
      steps.push({
        table: '*',
        description: 'restore foreign key checks',
        sqls: [sql]
      })
    }

    return { steps }
  }

  /** 真实执行：在目标库依次跑 SQL，并通过 SyncProgress 事件汇报进度 */
  async execute(
    req: SyncRequest,
    options: ExecuteSyncOptions = {}
  ): Promise<{ executed: number; errors: number }> {
    const emit = (event: SyncProgressEvent) => {
      options.onProgress?.(event)
    }
    const context = await this.loadSyncContext(req)

    let executed = 0
    let errors = 0
    let done = 0
    let total = 0

    const runSQL = async (table: string, sql: string, message?: string) => {
      total++
      if (message) {
        emit({ table, step: 'start', done, total, level: 'info', message })
      }
      try {
        await context.targetDriver.executeSQL(sql, req.targetDatabase)
        executed++
      } catch (err) {
        errors++
        emit({
          table,
          step: 'error',
          done,
          total,
          level: 'error',
          message: `${(err as Error).message} :: ${sql.slice(0, 200)}`
        })
      }
      done++
      if (done % 20 === 0 || done === total) {
        emit({ table, step: 'progress', done, total, level: 'info' })
      }
    }

    for (const sql of this.buildForeignKeyGuardSQLs(context.targetDriver, 'begin')) {
      await runSQL('*', sql, 'disable foreign key checks')
    }

    const truncateSQL = this.buildBatchTruncateSQL(req, context)
    if (truncateSQL) {
      await runSQL('*', truncateSQL, 'truncate selected tables (FK-safe batch)')
    }

    for (const table of context.orderedTables) {
      const prepared = await this.prepareTableSync(table, req, context, false, Boolean(truncateSQL))
      emit({
        table: prepared.table,
        step: 'start',
        done,
        total,
        level: 'info',
        message: prepared.description
      })

      const statements = this.iterateStatements(prepared, req, context)
      for await (const sql of statements) {
        await runSQL(prepared.table, sql)
      }
      emit({ table: prepared.table, step: 'done', done, total, level: 'info' })
    }

    for (const sql of this.buildForeignKeyGuardSQLs(context.targetDriver, 'end')) {
      await runSQL('*', sql, 'restore foreign key checks')
    }

    return { executed, errors }
  }

  private async loadSyncContext(req: SyncRequest): Promise<SyncContext> {
    const [sourceDriver, targetDriver] = await Promise.all([
      dbService.getDriver(req.sourceConnectionId),
      dbService.getDriver(req.targetConnectionId)
    ])
    const [sourceTableList, targetTableList, edges] = await Promise.all([
      sourceDriver.listTables(req.sourceDatabase),
      targetDriver.listTables(req.targetDatabase),
      this.loadForeignKeyEdges(sourceDriver, req.sourceDatabase)
    ])
    return {
      sourceDriver,
      targetDriver,
      sourceTables: new Set(sourceTableList),
      targetTables: new Set(targetTableList),
      crossEngine: sourceDriver.engine !== targetDriver.engine,
      orderedTables: orderTablesByForeignKeys(req.tables, edges)
    }
  }

  private async loadForeignKeyEdges(driver: DbDriver, database: string): Promise<ForeignKeyEdge[]> {
    if (!driver.listForeignKeyEdges) return []
    try {
      return await driver.listForeignKeyEdges(database)
    } catch {
      return []
    }
  }

  private buildForeignKeyGuardSQLs(targetDriver: DbDriver, phase: 'begin' | 'end'): string[] {
    if (targetDriver.engine !== 'mysql') return []
    return [phase === 'begin' ? 'SET FOREIGN_KEY_CHECKS=0;' : 'SET FOREIGN_KEY_CHECKS=1;']
  }

  private buildBatchTruncateSQL(req: SyncRequest, context: SyncContext): string | null {
    if (!req.syncData || req.existingTableStrategy !== 'truncate-and-import') return null

    const tables = context.orderedTables.filter((table) => context.targetTables.has(table))
    if (tables.length === 0) return null

    const targetScope = getTargetTableScope(context.targetDriver, req.targetDatabase)
    const dialect = context.targetDriver.dialect

    if (context.targetDriver.engine === 'postgres') {
      // Single multi-table TRUNCATE is FK-safe when all related selected tables are listed.
      return `TRUNCATE TABLE ${tables.map((table) => dialect.quoteTable(targetScope, table)).join(', ')};`
    }

    return tables.map((table) => dialect.renderTruncate(targetScope, table)).join('\n')
  }

  private async prepareTableSync(
    table: string,
    req: SyncRequest,
    context: SyncContext,
    preview: boolean,
    truncateAlreadyHandled: boolean
  ): Promise<PreparedTableSync> {
    const targetDialect = context.targetDriver.dialect
    const existsInTarget = context.targetTables.has(table)
    const existsInSource = context.sourceTables.has(table)

    if (!existsInSource) {
      return {
        table,
        description: existsInTarget
          ? 'only in target, skipped (drop manually if intended)'
          : 'missing in both source and target, skipped',
        schema: emptySchema(table),
        setupSQLs: [],
        skip: true
      }
    }

    const schema = await schemaService.getTableSchema(
      req.sourceConnectionId,
      req.sourceDatabase,
      table
    )
    const setupSQLs: string[] = []
    const description: string[] = []
    const targetScope = getTargetTableScope(context.targetDriver, req.targetDatabase)

    if (existsInTarget && req.existingTableStrategy === 'skip') {
      return {
        table,
        description: 'skip existing table',
        schema,
        setupSQLs,
        skip: true
      }
    }

    if (req.syncStructure) {
      if (existsInTarget) {
        switch (req.existingTableStrategy) {
          case 'overwrite-structure':
            setupSQLs.push(
              context.targetDriver.engine === 'postgres'
                ? `DROP TABLE IF EXISTS ${targetDialect.quoteTable(targetScope, table)} CASCADE;`
                : targetDialect.renderDropIfExists(targetScope, table)
            )
            setupSQLs.push(buildTargetCreateTableSQL(schema, req, context, targetScope))
            description.push('drop & recreate target table')
            break
          case 'append-data':
          case 'truncate-and-import':
            description.push(
              context.crossEngine ? 'reuse existing target structure' : 'keep target structure'
            )
            break
        }
      } else {
        setupSQLs.push(buildTargetCreateTableSQL(schema, req, context, targetScope))
        description.push('create table')
      }
    }

    if (req.syncData) {
      if (
        existsInTarget &&
        req.existingTableStrategy === 'truncate-and-import' &&
        !truncateAlreadyHandled
      ) {
        setupSQLs.push(targetDialect.renderTruncate(targetScope, table))
      }
      description.push(preview ? `data preview (${PREVIEW_ROW_LIMIT} rows)` : 'data sync')
    }

    return {
      table,
      description: description.join(', ') || 'noop',
      schema,
      setupSQLs,
      dataRowLimit: preview && req.syncData ? PREVIEW_ROW_LIMIT : undefined,
      skip: false
    }
  }

  private async *iterateStatements(
    prepared: PreparedTableSync,
    req: SyncRequest,
    context: SyncContext
  ): AsyncGenerator<string> {
    for (const sql of prepared.setupSQLs) {
      yield sql
    }
    if (!req.syncData || prepared.skip) return
    for await (const sql of this.generateInsertStatements(prepared, req, context)) {
      yield sql
    }
  }

  private async *generateInsertStatements(
    prepared: PreparedTableSync,
    req: SyncRequest,
    context: SyncContext
  ): AsyncGenerator<string> {
    const { schema } = prepared
    if (schema.columns.length === 0) return

    const targetDialect = context.targetDriver.dialect
    const targetScope = getTargetTableScope(context.targetDriver, req.targetDatabase)
    const columnNames = schema.columns.map((c) => c.name)

    for await (const batch of context.sourceDriver.streamRows({
      database: req.sourceDatabase,
      table: prepared.table,
      columns: columnNames,
      primaryKey: schema.primaryKey,
      batchSize: INSERT_BATCH_SIZE,
      limit: prepared.dataRowLimit
    })) {
      yield targetDialect.renderInsert(targetScope, prepared.table, schema.columns, batch)
    }
  }
}

function buildTargetCreateTableSQL(
  schema: TableSchema,
  req: SyncRequest,
  context: SyncContext,
  targetScope: string
): string {
  if (context.sourceDriver.engine !== context.targetDriver.engine) {
    return buildCreateTableSQL(schema, targetScope, context.sourceDriver, context.targetDriver.engine, {
      includeDatabasePrelude: false
    })
  }

  if (context.targetDriver.engine === 'postgres') {
    return buildCreateTableSQL(schema, targetScope, context.sourceDriver, 'postgres', {
      includeDatabasePrelude: false
    })
  }

  if (context.targetDriver.engine === 'mysql') {
    return buildCreateTableSQL(schema, req.targetDatabase, context.sourceDriver, 'mysql', {
      includeDatabasePrelude: false
    })
  }

  return ensureSemicolon(context.targetDriver.dialect.stripDefiner(schema.createSQL))
}

function getTargetTableScope(targetDriver: DbDriver, targetDatabase: string): string {
  // PostgresDriver connects to the selected database and uses the public schema for table ops.
  return targetDriver.engine === 'postgres' ? 'public' : targetDatabase
}

function emptySchema(table: string): TableSchema {
  return {
    name: table,
    columns: [],
    indexes: [],
    primaryKey: [],
    createSQL: ''
  }
}

function ensureSemicolon(sql: string): string {
  const trimmed = sql.trim()
  if (!trimmed) return ''
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`
}

export const syncService = new SyncService()
