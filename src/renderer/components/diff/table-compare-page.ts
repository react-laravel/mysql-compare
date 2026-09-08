import type { QueryRowsRequest, QueryRowsResult } from '../../../shared/types'
import { buildRowKey } from './table-compare-utils'

type Endpoint = Pick<QueryRowsRequest, 'connectionId' | 'database' | 'table'>

export function sharedComparisonKey(source: QueryRowsResult, target: QueryRowsResult): string[] {
  const targetKeys = new Set(target.primaryKey)
  return source.primaryKey.length > 0 && source.primaryKey.length === targetKeys.size
    && source.primaryKey.every((column) => targetKeys.has(column)) ? source.primaryKey : []
}

/** Keep page navigation, but resolve every unmatched key against the entire peer table. */
export async function completeComparisonPage(
  source: QueryRowsResult,
  target: QueryRowsResult,
  sourceEndpoint: Endpoint,
  targetEndpoint: Endpoint,
  queryRows: (request: QueryRowsRequest) => Promise<QueryRowsResult>
): Promise<[QueryRowsResult, QueryRowsResult]> {
  const keyColumns = sharedComparisonKey(source, target)
  if (keyColumns.length === 0) return [source, target]
  const supplement = async (own: QueryRowsResult, peer: QueryRowsResult, endpoint: Endpoint) => {
    const ownKeys = new Set(own.rows.map((row) => buildRowKey(row, keyColumns)))
    if (ownKeys.has(null) || ownKeys.size !== own.rows.length) throw new Error('Comparison requires unique, complete primary keys')
    if (own.rows.length === own.total) return own
    const missing = peer.rows.filter((row) => !ownKeys.has(buildRowKey(row, keyColumns)))
    if (missing.length === 0) return own
    const keyRows = missing.map((row) => Object.fromEntries(keyColumns.map((key) => [key, row[key]])))
    const matching = await queryRows({ ...endpoint, keyRows, page: 1, pageSize: 1000 })
    const rows = [...own.rows]
    for (const row of matching.rows) {
      const key = buildRowKey(row, keyColumns)
      if (!key) throw new Error('Comparison returned an incomplete primary key')
      if (!ownKeys.has(key)) { rows.push(row); ownKeys.add(key) }
    }
    return { ...own, rows }
  }
  return Promise.all([supplement(source, target, sourceEndpoint), supplement(target, source, targetEndpoint)])
}
