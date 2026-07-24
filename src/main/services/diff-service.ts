// 数据库结构 / 数据对比：表 / 列 / 索引定义 + 主键配对的行级 data diff。
import type {
  DatabaseDiff,
  TableDataDiff,
  TableRowComparison,
  TableDiff
} from '../../shared/types'
import { dbService } from './db-service'
import { diffTableData } from './diff-service-data'
import { diffColumns, diffIndexes } from './diff-service-schema'
import type { DbDriver } from './drivers/types'

const TABLE_SCHEMA_DIFF_CONCURRENCY = 4

export class DiffService {
  async diffTable(
    sourceConnectionId: string,
    sourceDatabase: string,
    targetConnectionId: string,
    targetDatabase: string,
    table: string,
    includeData = false
  ): Promise<{ tableDiff: TableDiff | null; rowComparison: TableRowComparison | null }> {
    const [sourceDriver, targetDriver] = await Promise.all([
      dbService.getDriver(sourceConnectionId),
      dbService.getDriver(targetConnectionId)
    ])

    return compareSharedTable({
      sourceDriver,
      sourceDatabase,
      targetDriver,
      targetDatabase,
      table,
      includeData
    })
  }

  async diffDatabases(
    sourceConnectionId: string,
    sourceDatabase: string,
    targetConnectionId: string,
    targetDatabase: string,
    includeData = false,
    tables?: string[]
  ): Promise<DatabaseDiff> {
    const [sDriver, tDriver] = await Promise.all([
      dbService.getDriver(sourceConnectionId),
      dbService.getDriver(targetConnectionId)
    ])
    assertDiffSupported(sDriver, tDriver)
    const [sTables, tTables] = await Promise.all([
      sDriver.listTables(sourceDatabase),
      tDriver.listTables(targetDatabase)
    ])
    const all = (tables && tables.length > 0)
      ? Array.from(new Set(tables)).sort()
      : Array.from(new Set([...sTables, ...tTables])).sort()
    const sourceTableSet = new Set(sTables)
    const targetTableSet = new Set(tTables)
    const results = await mapWithConcurrencyLimit<
      string,
      { tableDiff: TableDiff | null; rowComparison: TableRowComparison | null }
    >(
      all,
      TABLE_SCHEMA_DIFF_CONCURRENCY,
      async (table) => {
        const inSource = sourceTableSet.has(table)
        const inTarget = targetTableSet.has(table)

        if (inSource && !inTarget) {
          return {
            tableDiff: { table, kind: 'only-in-source', columnDiffs: [], indexDiffs: [] } satisfies TableDiff,
            rowComparison: null
          }
        }

        if (!inSource && inTarget) {
          return {
            tableDiff: { table, kind: 'only-in-target', columnDiffs: [], indexDiffs: [] } satisfies TableDiff,
            rowComparison: null
          }
        }

        if (!inSource && !inTarget) {
          return {
            tableDiff: null,
            rowComparison: null
          }
        }

        return compareSharedTable({
          sourceDriver: sDriver,
          sourceDatabase,
          targetDriver: tDriver,
          targetDatabase,
          table,
          includeData
        })
      }
    )

    return {
      sourceDatabase,
      targetDatabase,
      tableDiffs: results.map((result) => result.tableDiff).filter(isTableDiff),
      rowComparisons: results.map((result) => result.rowComparison).filter(isRowComparison)
    }
  }
}

async function compareSharedTable(params: {
  sourceDriver: DbDriver
  sourceDatabase: string
  targetDriver: DbDriver
  targetDatabase: string
  table: string
  includeData: boolean
}): Promise<{ tableDiff: TableDiff | null; rowComparison: TableRowComparison | null }> {
  assertDiffSupported(params.sourceDriver, params.targetDriver)
  const [sourceSchema, targetSchema] = await Promise.all([
    params.sourceDriver.getTableSchema(params.sourceDatabase, params.table),
    params.targetDriver.getTableSchema(params.targetDatabase, params.table)
  ])
  const columnDiffs = diffColumns(
    sourceSchema.columns,
    targetSchema.columns,
    params.sourceDriver.engine,
    params.targetDriver.engine
  )
  const indexDiffs = diffIndexes(sourceSchema.indexes, targetSchema.indexes)
  const dataDiff = params.includeData
    ? await diffTableData({
        sourceDriver: params.sourceDriver,
        sourceDatabase: params.sourceDatabase,
        sourceSchema,
        targetDriver: params.targetDriver,
        targetDatabase: params.targetDatabase,
        targetSchema,
        table: params.table
      })
    : undefined

  const rowComparison = dataDiff
    ? ({ table: params.table, dataDiff } satisfies TableRowComparison)
    : null

  if (columnDiffs.length === 0 && indexDiffs.length === 0 && !hasMeaningfulDataDiff(dataDiff)) {
    return {
      tableDiff: null,
      rowComparison
    }
  }

  return {
    tableDiff: {
      table: params.table,
      kind: 'modified',
      columnDiffs,
      indexDiffs,
      dataDiff
    } satisfies TableDiff,
    rowComparison
  }
}

function assertDiffSupported(sourceDriver: DbDriver, targetDriver: DbDriver): void {
  if (sourceDriver.engine === 'redis' || targetDriver.engine === 'redis') {
    throw new Error('Redis connections do not support schema/data diff')
  }
}

function isTableDiff(tableDiff: TableDiff | null): tableDiff is TableDiff {
  return tableDiff !== null
}

function isRowComparison(
  rowComparison: TableRowComparison | null
): rowComparison is TableRowComparison {
  return rowComparison !== null
}

function hasMeaningfulDataDiff(dataDiff?: TableDataDiff): boolean {
  if (!dataDiff?.comparable) return false
  return dataDiff.sourceOnly > 0 || dataDiff.targetOnly > 0 || dataDiff.modified > 0
}

async function mapWithConcurrencyLimit<T, TResult>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) return []

  const results = new Array<TResult>(items.length)
  const workerCount = Math.min(Math.max(concurrency, 1), items.length)
  let nextIndex = 0
  let firstError: unknown = undefined

  // 每个表会同时打到源库和目标库，限制并发可以避免把连接池瞬间打满。
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length && firstError === undefined) {
        const currentIndex = nextIndex
        nextIndex += 1
        const item = items[currentIndex]
        if (item === undefined) {
          return
        }
        try {
          results[currentIndex] = await mapper(item, currentIndex)
        } catch (error) {
          firstError = error
          return
        }
      }
    })
  )

  if (firstError !== undefined) {
    throw firstError
  }

  return results
}

export const diffService = new DiffService()
