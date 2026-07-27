// The one description of a `table-compare` tab.
//
// Two entrances land on this view now (blueprint §2.4): the diff panel's
// "Open compare" and a table row's "Compare with…". They must produce the
// *same* `compareSessionId` for the same pair, because `ui-store.getTabId`
// derives the tab id from it — otherwise the two entrances would open two tabs
// for one comparison.
import type { WorkspaceView } from '@renderer/store/ui-store'

export interface TableCompareEndpoints {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  table: string
}

export type TableCompareView = Extract<WorkspaceView, { kind: 'table-compare' }>

export function buildTableCompareSessionId(endpoints: TableCompareEndpoints): string {
  return [
    endpoints.sourceConnectionId,
    endpoints.sourceDatabase,
    endpoints.targetConnectionId,
    endpoints.targetDatabase,
    endpoints.table
  ].join(':')
}

/**
 * `comparedTables` / `diffTables` drive the "next table with differences"
 * navigation. Opened from a table row there is no comparison run behind the
 * view, so the only compared table is this one and there is nothing to step to.
 */
export function buildTableCompareView(
  endpoints: TableCompareEndpoints,
  options: { comparedTables?: string[]; diffTables?: string[] } = {}
): TableCompareView {
  return {
    kind: 'table-compare',
    compareSessionId: buildTableCompareSessionId(endpoints),
    ...endpoints,
    comparedTables: options.comparedTables ?? [endpoints.table],
    diffTables: options.diffTables ?? []
  }
}
