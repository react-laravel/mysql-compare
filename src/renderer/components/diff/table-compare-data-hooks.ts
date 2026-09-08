// Loading and aligning the two sides of a table compare.
//
// Extracted from `TableCompareView` in chunk 10 so the view is layout + verbs
// and this module is "how the two grids get their rows". Behaviour is
// unchanged: the same per-side request de-duplication, the same shared
// stable-order column, the same prefetch of the next tables with differences.
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { api, unwrap } from '@renderer/lib/api'
import { completeComparisonPage, sharedComparisonKey } from './table-compare-page'
import type { QueryRowsResult } from '../../../shared/types'
import { getUpcomingRowDiffTables } from './diff-panel-utils'
import {
  fetchComparedTableData,
  clearComparedTableCacheScope,
  prefetchComparedTables,
  type ComparedTableRowsQuery
} from './table-compare-data-cache'
import { buildAlignedCompareRows, buildRowDiffLookup, type AlignedCompareRow, type RowDiffLookup } from './table-compare-diff'
import { useComparePaneSelection, type ComparePaneSelection } from './table-compare-selection'
import { buildCompareColumns, type CompareColumn } from './table-compare-utils'

export interface ComparedTableDataState {
  data: QueryRowsResult | null
  error: string | null
  loading: boolean
}

export interface TableCompareModelOptions {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  table: string
  page: number
  pageSize: number
  comparedTables: string[]
  diffTables: string[]
  active?: boolean
}

export interface TableCompareModel {
  sourceState: ComparedTableDataState
  targetState: ComparedTableDataState
  setSourceState: Dispatch<SetStateAction<ComparedTableDataState>>
  setTargetState: Dispatch<SetStateAction<ComparedTableDataState>>
  sourceSelection: ComparePaneSelection
  targetSelection: ComparePaneSelection
  sourceKeyColumns: string[]
  targetKeyColumns: string[]
  compareColumns: CompareColumn[]
  rowDiffLookup: RowDiffLookup | null
  alignedRows: AlignedCompareRow[] | null
  totalRows: number
  reloadSource: () => void
  reloadTarget: () => void
  reloadBoth: () => void
}

const PREFETCH_TABLE_COUNT = 3

let tableCompareCacheScopeCounter = 0

export function useTableCompareModel({
  sourceConnectionId,
  sourceDatabase,
  targetConnectionId,
  targetDatabase,
  table,
  page,
  pageSize,
  comparedTables,
  diffTables,
  active = true
}: TableCompareModelOptions): TableCompareModel {
  const cacheScopeKeyRef = useRef<string | null>(null)
  if (cacheScopeKeyRef.current === null) {
    tableCompareCacheScopeCounter += 1
    cacheScopeKeyRef.current = `table-compare:${tableCompareCacheScopeCounter}`
  }
  const cacheScopeKey = cacheScopeKeyRef.current

  const [sourceReloadToken, setSourceReloadToken] = useState(0)
  const [targetReloadToken, setTargetReloadToken] = useState(0)
  const [sourceState, setSourceState] = useState<ComparedTableDataState>({
    data: null,
    error: null,
    loading: false
  })
  const [targetState, setTargetState] = useState<ComparedTableDataState>({
    data: null,
    error: null,
    loading: false
  })

  const compareColumns = useMemo(
    () => buildCompareColumns(sourceState.data?.columns ?? [], targetState.data?.columns ?? []),
    [sourceState.data?.columns, targetState.data?.columns]
  )
  const sharedKeyColumns = useMemo(() => sourceState.data && targetState.data
    ? sharedComparisonKey(sourceState.data, targetState.data) : [], [sourceState.data, targetState.data])
  const compareColumnNames = useMemo(
    () =>
      compareColumns.filter((column) => column.source && column.target).map((column) => column.name),
    [compareColumns]
  )
  const rowDiffLookup = useMemo(() => {
    if (sourceState.loading || targetState.loading || !sourceState.data || !targetState.data) return null

    return buildRowDiffLookup(
      sourceState.data.rows,
      targetState.data.rows,
      sharedKeyColumns,
      compareColumnNames
    )
  }, [compareColumnNames, sharedKeyColumns, sourceState.data, targetState.data, sourceState.loading, targetState.loading])
  const alignedRows = useMemo(() => {
    if (sourceState.loading || targetState.loading || !sourceState.data || !targetState.data) return null

    return buildAlignedCompareRows(sourceState.data.rows, targetState.data.rows, sharedKeyColumns)
  }, [sharedKeyColumns, sourceState.data, targetState.data, sourceState.loading, targetState.loading])

  const sourceKeyColumns = sourceState.data?.primaryKey ?? []
  const targetKeyColumns = targetState.data?.primaryKey ?? []
  const sourceSelection = useComparePaneSelection(sourceState.data, sourceKeyColumns)
  const targetSelection = useComparePaneSelection(targetState.data, targetKeyColumns)

  // A different table (or endpoint) is a different comparison: drop the rows
  // and the selection rather than showing the previous table's data while the
  // new one loads.
  useEffect(() => {
    sourceSelection.clearSelection()
    targetSelection.clearSelection()
    setSourceState({ data: null, error: null, loading: true })
    setTargetState({ data: null, error: null, loading: true })
  }, [sourceConnectionId, sourceDatabase, targetConnectionId, targetDatabase, table])

  useEffect(() => {
    let disposed = false
    const sourceQuery: ComparedTableRowsQuery = { cacheScopeKey, connectionId: sourceConnectionId, database: sourceDatabase, table, page, pageSize, reloadToken: sourceReloadToken }
    const targetQuery: ComparedTableRowsQuery = { cacheScopeKey, connectionId: targetConnectionId, database: targetDatabase, table, page, pageSize, reloadToken: targetReloadToken }
    setSourceState((current) => ({ ...current, loading: true, error: null }))
    setTargetState((current) => ({ ...current, loading: true, error: null }))
    void Promise.all([fetchComparedTableData(sourceQuery), fetchComparedTableData(targetQuery)])
      .then(async ([source, target]) => {
        if (disposed) return
        const [completeSource, completeTarget] = await completeComparisonPage(source, target, sourceQuery, targetQuery, (request) => unwrap(api.db.queryRows(request)))
        if (disposed) return
        setSourceState({ data: completeSource, error: null, loading: false })
        setTargetState({ data: completeTarget, error: null, loading: false })
      })
      .catch((error: unknown) => {
        if (disposed) return
        const state = { data: null, loading: false, error: error instanceof Error ? error.message : String(error) }
        setSourceState(state)
        setTargetState(state)
      })
    return () => { disposed = true }
  }, [cacheScopeKey, sourceConnectionId, sourceDatabase, targetConnectionId, targetDatabase, table, page, pageSize, sourceReloadToken, targetReloadToken])

  useEffect(() => () => clearComparedTableCacheScope(cacheScopeKey), [cacheScopeKey])

  const upcomingDiffTables = useMemo(
    () => getUpcomingRowDiffTables(comparedTables, diffTables, table, PREFETCH_TABLE_COUNT),
    [comparedTables, diffTables, table]
  )

  // "Next table with differences" is one click away, so its rows are warmed
  // once the current table has settled on both sides.
  useEffect(() => {
    if (!active || upcomingDiffTables.length === 0) return
    if (sourceState.loading || targetState.loading) return
    if (!sourceState.data || !targetState.data) return
    if (sourceState.error || targetState.error) return

    void prefetchComparedTables({
      cacheScopeKey,
      sourceConnectionId,
      sourceDatabase,
      sourceReloadToken,
      targetConnectionId,
      targetDatabase,
      targetReloadToken,
      tables: upcomingDiffTables,
      page: 1,
      pageSize
    }).catch(() => undefined)
  }, [
    active,
    cacheScopeKey,
    pageSize,
    sourceConnectionId,
    sourceDatabase,
    sourceReloadToken,
    targetConnectionId,
    targetDatabase,
    targetReloadToken,
    sourceState.data,
    sourceState.error,
    sourceState.loading,
    targetState.data,
    targetState.error,
    targetState.loading,
    upcomingDiffTables
  ])

  const totalRows = useMemo(
    () => Math.max(sourceState.data?.total ?? 0, targetState.data?.total ?? 0),
    [sourceState.data, targetState.data]
  )

  const reloadSource = () => setSourceReloadToken((current) => current + 1)
  const reloadTarget = () => setTargetReloadToken((current) => current + 1)

  return {
    sourceState,
    targetState,
    setSourceState,
    setTargetState,
    sourceSelection,
    targetSelection,
    sourceKeyColumns,
    targetKeyColumns,
    compareColumns,
    rowDiffLookup,
    alignedRows,
    totalRows,
    reloadSource,
    reloadTarget,
    reloadBoth: () => {
      reloadSource()
      reloadTarget()
    }
  }
}
