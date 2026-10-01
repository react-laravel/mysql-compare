import type {
  DatabaseDiff,
  DiffRequest,
  IPCResult,
  TableComparisonResult,
  TableDiffRequest
} from '../../../shared/types'

export interface TableDiffRequestRouter {
  databases: (req: DiffRequest, operationId?: string) => Promise<IPCResult<DatabaseDiff>>
  table?: (req: TableDiffRequest, operationId?: string) => Promise<IPCResult<TableComparisonResult>>
}

export function supportsIncrementalTableDiff(
  router: TableDiffRequestRouter
): router is TableDiffRequestRouter & {
  table: (req: TableDiffRequest, operationId?: string) => Promise<IPCResult<TableComparisonResult>>
} {
  return typeof router.table === 'function'
}

export function extractTableComparisonResult(
  diff: DatabaseDiff,
  table: string
): TableComparisonResult {
  return {
    tableDiff: diff.tableDiffs.find((item) => item.table === table) ?? null,
    rowComparison: diff.rowComparisons.find((item) => item.table === table) ?? null
  }
}

export async function requestTableComparison(
  router: TableDiffRequestRouter,
  req: TableDiffRequest,
  operationId?: string
): Promise<IPCResult<TableComparisonResult>> {
  if (supportsIncrementalTableDiff(router)) {
    return operationId ? router.table(req, operationId) : router.table(req)
  }

  const result = await router.databases({
    sourceConnectionId: req.sourceConnectionId,
    sourceDatabase: req.sourceDatabase,
    targetConnectionId: req.targetConnectionId,
    targetDatabase: req.targetDatabase,
    includeData: req.includeData,
    tables: [req.table]
  }, operationId)

  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  return {
    ok: true,
    data: extractTableComparisonResult(result.data as DatabaseDiff, req.table)
  }
}