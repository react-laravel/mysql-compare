// Loading and aligning the two sides of a table compare.
//
// Extracted from `TableCompareView` in chunk 10 so the view is layout + verbs
// and this module is "how the two grids get their rows". Behaviour is
// unchanged: the same per-side request de-duplication, the same shared
// stable-order column, the same prefetch of the next tables with differences.
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { QueryRowsResult } from '../../../shared/types'
import { getUpcomingRowDiffTables } from './diff-panel-utils'
import {
  fetchComparedTableData,
  getCachedComparedTableData,
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
  diffTables
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

  // Both sides must be paged by the *same* column or the rows do not line up.
  const stableOrderColumn = useMemo(() => {
    const sourcePrimaryKey = sourceState.data?.primaryKey ?? []
    const targetPrimaryKey = new Set(targetState.data?.primaryKey ?? [])
    return sourcePrimaryKey.find((column) => targetPrimaryKey.has(column)) ?? null
  }, [sourceState.data, targetState.data])
  const stableOrderBy = useMemo(
    () => (stableOrderColumn ? { column: stableOrderColumn, dir: 'ASC' as const } : undefined),
    [stableOrderColumn]
  )
  const compareColumns = useMemo(
    () => buildCompareColumns(sourceState.data?.columns ?? [], targetState.data?.columns ?? []),
    [sourceState.data?.columns, targetState.data?.columns]
  )
  const sharedKeyColumns = useMemo(() => {
    const targetPrimaryKey = new Set(targetState.data?.primaryKey ?? [])
    return (sourceState.data?.primaryKey ?? []).filter((column) => targetPrimaryKey.has(column))
  }, [sourceState.data?.primaryKey, targetState.data?.primaryKey])
  const compareColumnNames = useMemo(
    () =>
      compareColumns.filter((column) => column.source && column.target).map((column) => column.name),
    [compareColumns]
  )
  const rowDiffLookup = useMemo(() => {
    if (!sourceState.data || !targetState.data) return null

    return buildRowDiffLookup(
      sourceState.data.rows,
      targetState.data.rows,
      sharedKeyColumns,
      compareColumnNames
    )
  }, [compareColumnNames, sharedKeyColumns, sourceState.data, targetState.data])
  const alignedRows = useMemo(() => {
    if (!sourceState.data || !targetState.data) return null

    return buildAlignedCompareRows(sourceState.data.rows, targetState.data.rows, sharedKeyColumns)
  }, [sharedKeyColumns, sourceState.data, targetState.data])

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

  useComparedTableData({
    cacheScopeKey,
    connectionId: sourceConnectionId,
    database: sourceDatabase,
    table,
    page,
    pageSize,
    reloadToken: sourceReloadToken,
    orderBy: stableOrderBy,
    onStateChange: setSourceState
  })

  useComparedTableData({
    cacheScopeKey,
    connectionId: targetConnectionId,
    database: targetDatabase,
    table,
    page,
    pageSize,
    reloadToken: targetReloadToken,
    orderBy: stableOrderBy,
    onStateChange: setTargetState
  })

  const upcomingDiffTables = useMemo(
    () => getUpcomingRowDiffTables(comparedTables, diffTables, table, PREFETCH_TABLE_COUNT),
    [comparedTables, diffTables, table]
  )

  // "Next table with differences" is one click away, so its rows are warmed
  // once the current table has settled on both sides.
  useEffect(() => {
    if (upcomingDiffTables.length === 0) return
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

function useComparedTableData({
  cacheScopeKey,
  connectionId,
  database,
  table,
  page,
  pageSize,
  reloadToken,
  orderBy,
  onStateChange
}: {
  cacheScopeKey: string
  connectionId: string
  database: string
  table: string
  page: number
  pageSize: number
  reloadToken: number
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
  onStateChange: Dispatch<SetStateAction<ComparedTableDataState>>
}): void {
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    const query: ComparedTableRowsQuery = {
      cacheScopeKey,
      connectionId,
      database,
      table,
      page,
      pageSize,
      reloadToken,
      orderBy
    }

    const cached = getCachedComparedTableData(query)
    if (cached) {
      onStateChange({
        data: cached,
        error: null,
        loading: false
      })
      return
    }

    onStateChange((current) => ({
      ...current,
      loading: true,
      error: null
    }))

    void (async () => {
      try {
        const data = await fetchComparedTableData(query)

        if (requestIdRef.current !== requestId) return

        onStateChange({
          data,
          error: null,
          loading: false
        })
      } catch (err) {
        if (requestIdRef.current !== requestId) return

        onStateChange({
          data: null,
          error: (err as Error).message,
          loading: false
        })
      }
    })()
  }, [cacheScopeKey, connectionId, database, onStateChange, orderBy, page, pageSize, reloadToken, table])
}
