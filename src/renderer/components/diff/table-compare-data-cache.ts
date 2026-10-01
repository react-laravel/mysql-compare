import { api, unwrap } from '@renderer/lib/api'
import type { QueryRowsRequest, QueryRowsResult } from '../../../shared/types'

const comparedTableDataCache = new Map<string, QueryRowsResult>()
const pendingComparedTableRequests = new Map<string, { scope: string; promise: Promise<QueryRowsResult> }>()
const operations = new Map<string, { scope: string; cancelled: boolean }>()

export async function queryComparedRows(scope: string, request: QueryRowsRequest): Promise<QueryRowsResult> {
  const id = crypto.randomUUID()
  const operation = { scope, cancelled: false }
  operations.set(id, operation)
  try {
    const data = await unwrap<QueryRowsResult>(api.db.queryRows(request, id))
    if (operation.cancelled) throw new Error('Operation cancelled')
    return data
  } finally { operations.delete(id) }
}

/** Cancel reads, including prefetches and unmatched-key lookups, for one tab. */
export function cancelComparedTableCacheScope(scope: string): void {
  for (const [id, operation] of operations) if (operation.scope === scope) {
    operation.cancelled = true
    void api.operations?.cancel(id).catch(() => undefined)
  }
  for (const [key, pending] of pendingComparedTableRequests) if (pending.scope === scope) pendingComparedTableRequests.delete(key)
  clearComparedTableCacheScope(scope)
}

const MAX_CACHED_RESULTS = 96
const MAX_CACHED_BYTES = 32 * 1024 * 1024
const cacheSizes = new Map<string, number>()
const scopeVersions = new Map<string, number>()
let cachedBytes = 0

export function clearComparedTableCacheScope(scope: string): void {
  scopeVersions.set(scope, (scopeVersions.get(scope) ?? 0) + 1)
  for (const key of comparedTableDataCache.keys()) {
    if ((JSON.parse(key) as unknown[])[0] === scope) {
      cachedBytes -= cacheSizes.get(key) ?? 0
      cacheSizes.delete(key)
      comparedTableDataCache.delete(key)
    }
  }
}


export interface ComparedTableRowsQuery {
  cacheScopeKey: string
  connectionId: string
  database: string
  table: string
  page: number
  pageSize: number
  reloadToken: number
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
}

interface PrefetchComparedTablesOptions {
  cacheScopeKey: string
  sourceConnectionId: string
  sourceDatabase: string
  sourceReloadToken: number
  targetConnectionId: string
  targetDatabase: string
  targetReloadToken: number
  tables: string[]
  page: number
  pageSize: number
}

export function getCachedComparedTableData(query: ComparedTableRowsQuery): QueryRowsResult | undefined {
  const key = buildComparedTableQueryKey(query)
  const cached = comparedTableDataCache.get(key)
  if (cached) { comparedTableDataCache.delete(key); comparedTableDataCache.set(key, cached) }
  return cached
}

export async function fetchComparedTableData(query: ComparedTableRowsQuery): Promise<QueryRowsResult> {
  const cacheKey = buildComparedTableQueryKey(query)
  const cached = getCachedComparedTableData(query)
  if (cached) return cached

  const pending = pendingComparedTableRequests.get(cacheKey)
  if (pending) return pending.promise

  const version = scopeVersions.get(query.cacheScopeKey) ?? 0
  const request = queryComparedRows(query.cacheScopeKey, {
      connectionId: query.connectionId,
      database: query.database,
      table: query.table,
      page: query.page,
      pageSize: query.pageSize,
      orderBy: query.orderBy
    })
    .then((data) => {
      if (version === (scopeVersions.get(query.cacheScopeKey) ?? 0)) {
        const bytes = JSON.stringify(data).length * 2
        if (bytes <= MAX_CACHED_BYTES) {
          comparedTableDataCache.set(cacheKey, data)
          cacheSizes.set(cacheKey, bytes)
          cachedBytes += bytes
          trimComparedTableDataCache()
        }
      }
      return data
    })
    .finally(() => {
      if (pendingComparedTableRequests.get(cacheKey)?.promise === request) pendingComparedTableRequests.delete(cacheKey)
    })

  pendingComparedTableRequests.set(cacheKey, { scope: query.cacheScopeKey, promise: request })
  return request
}

export async function prefetchComparedTables(options: PrefetchComparedTablesOptions): Promise<void> {
  for (const table of options.tables) {
    const sourceQuery: ComparedTableRowsQuery = {
      cacheScopeKey: options.cacheScopeKey,
      connectionId: options.sourceConnectionId,
      database: options.sourceDatabase,
      table,
      page: options.page,
      pageSize: options.pageSize,
      reloadToken: options.sourceReloadToken
    }
    const targetQuery: ComparedTableRowsQuery = {
      cacheScopeKey: options.cacheScopeKey,
      connectionId: options.targetConnectionId,
      database: options.targetDatabase,
      table,
      page: options.page,
      pageSize: options.pageSize,
      reloadToken: options.targetReloadToken
    }

    await Promise.all([
      fetchComparedTableData(sourceQuery),
      fetchComparedTableData(targetQuery)
    ])


  }
}

function buildComparedTableQueryKey(query: ComparedTableRowsQuery): string {
  return JSON.stringify([
    query.cacheScopeKey,
    query.connectionId,
    query.database,
    query.table,
    query.page,
    query.pageSize,
    query.reloadToken,
    query.orderBy?.column ?? null,
    query.orderBy?.dir ?? null
  ])
}

function trimComparedTableDataCache(): void {
  while (comparedTableDataCache.size > MAX_CACHED_RESULTS || cachedBytes > MAX_CACHED_BYTES) {
    const oldestKey = comparedTableDataCache.keys().next().value
    if (!oldestKey) return
    cachedBytes -= cacheSizes.get(oldestKey) ?? 0
    cacheSizes.delete(oldestKey)
    comparedTableDataCache.delete(oldestKey)
  }
}