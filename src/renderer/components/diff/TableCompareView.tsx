import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type UIEvent } from 'react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { pickPK } from '@renderer/lib/utils'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import type { QueryRowsResult } from '../../../shared/types'
import { getRowDiffNavigation, getUpcomingRowDiffTables } from './diff-panel-utils'
import {
  fetchComparedTableData,
  getCachedComparedTableData,
  prefetchComparedTables,
  type ComparedTableRowsQuery
} from './table-compare-data-cache'
import { buildAlignedCompareRows, buildRowDiffLookup, syncComparePaneScroll } from './table-compare-diff'
import {
  buildCompareColumns,
  buildCopyValues,
  buildOverwriteTargetSyncRequest,
  buildRowKey
} from './table-compare-utils'
import { useComparePaneSelection } from './table-compare-selection'
import { TableComparePane } from './TableComparePane'
import { TableDataPagination } from '@renderer/components/table-view/TableDataPagination'

interface Props {
  compareSessionId: string
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  table: string
  comparedTables: string[]
  diffTables: string[]
}

interface ComparedTableDataState {
  data: QueryRowsResult | null
  error: string | null
  loading: boolean
}

const DEFAULT_PAGE_SIZE = 100
const PREFETCH_TABLE_COUNT = 3

let tableCompareCacheScopeCounter = 0

export function TableCompareView({
  compareSessionId,
  sourceConnectionId,
  sourceDatabase,
  targetConnectionId,
  targetDatabase,
  table,
  comparedTables,
  diffTables
}: Props) {
  const { connections } = useConnectionStore()
  const { setRightView, showToast } = useUIStore()
  const { t } = useI18n()
  const [page, setPage] = useState(1)
  const [pageDraft, setPageDraft] = useState('1')
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [sourceReloadToken, setSourceReloadToken] = useState(0)
  const [targetReloadToken, setTargetReloadToken] = useState(0)
  const [copying, setCopying] = useState(false)
  const [overwriting, setOverwriting] = useState(false)
  const [deletingSide, setDeletingSide] = useState<'source' | 'target' | null>(null)
  const sourceScrollRef = useRef<HTMLDivElement | null>(null)
  const targetScrollRef = useRef<HTMLDivElement | null>(null)
  const syncScrollFrameRef = useRef<number | null>(null)
  const syncingScrollRef = useRef(false)
  const cacheScopeKeyRef = useRef<string | null>(null)
  if (cacheScopeKeyRef.current === null) {
    tableCompareCacheScopeCounter += 1
    cacheScopeKeyRef.current = `table-compare:${tableCompareCacheScopeCounter}`
  }

  const cacheScopeKey = cacheScopeKeyRef.current

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
    () => compareColumns.filter((column) => column.source && column.target).map((column) => column.name),
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

    return buildAlignedCompareRows(
      sourceState.data.rows,
      targetState.data.rows,
      sharedKeyColumns
    )
  }, [sharedKeyColumns, sourceState.data, targetState.data])

  const sourceKeyColumns = sourceState.data?.primaryKey ?? []
  const targetKeyColumns = targetState.data?.primaryKey ?? []
  const sourceSelection = useComparePaneSelection(sourceState.data, sourceKeyColumns)
  const targetSelection = useComparePaneSelection(targetState.data, targetKeyColumns)

  useEffect(() => {
    setPage(1)
    setPageDraft('1')
    sourceSelection.clearSelection()
    targetSelection.clearSelection()
    setSourceState({
      data: null,
      error: null,
      loading: true
    })
    setTargetState({
      data: null,
      error: null,
      loading: true
    })
  }, [sourceConnectionId, sourceDatabase, targetConnectionId, targetDatabase, table])

  useEffect(() => {
    sourceScrollRef.current?.scrollTo({ top: 0, left: 0 })
    targetScrollRef.current?.scrollTo({ top: 0, left: 0 })
  }, [page, sourceConnectionId, sourceDatabase, targetConnectionId, targetDatabase, table])

  useEffect(() => {
    return () => {
      if (syncScrollFrameRef.current !== null) {
        cancelAnimationFrame(syncScrollFrameRef.current)
      }
    }
  }, [])
  const upcomingDiffTables = useMemo(
    () => getUpcomingRowDiffTables(comparedTables, diffTables, table, PREFETCH_TABLE_COUNT),
    [comparedTables, diffTables, table]
  )

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

  const sourceConnection =
    connections.find((connection) => connection.id === sourceConnectionId) ?? null
  const targetConnection =
    connections.find((connection) => connection.id === targetConnectionId) ?? null
  const sourceConnectionName = sourceConnection?.name ?? sourceConnectionId
  const targetConnectionName = targetConnection?.name ?? targetConnectionId
  const totalRows = useMemo(() => {
    const sourceTotal = sourceState.data?.total ?? 0
    const targetTotal = targetState.data?.total ?? 0
    return Math.max(sourceTotal, targetTotal)
  }, [sourceState.data, targetState.data])
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalRows / pageSize)),
    [pageSize, totalRows]
  )

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  useEffect(() => {
    setPageDraft(String(page))
  }, [page])

  const goToPage = (nextPage: number) => {
    const safePage = Math.max(1, Math.min(totalPages, nextPage))
    setPage(safePage)
  }

  const submitPageDraft = () => {
    const parsed = Number.parseInt(pageDraft, 10)
    if (Number.isFinite(parsed)) {
      goToPage(parsed)
      return
    }
    setPageDraft(String(page))
  }

  const onPageSizeChange = (nextPageSize: number) => {
    setPageSize(nextPageSize)
    setPage(1)
  }
  const rowDiffNavigation = useMemo(
    () => getRowDiffNavigation(comparedTables, diffTables, table),
    [comparedTables, diffTables, table]
  )
  const actionBusy = copying || overwriting || deletingSide !== null

  const refreshBoth = () => {
    setSourceReloadToken((current) => current + 1)
    setTargetReloadToken((current) => current + 1)
  }

  const navigateToTable = (nextTable: string) => {
    setRightView({
      kind: 'table-compare',
      compareSessionId,
      sourceConnectionId,
      sourceDatabase,
      targetConnectionId,
      targetDatabase,
      table: nextTable,
      comparedTables,
      diffTables
    })
  }

  const openSourceTable = () => {
    setRightView({
      kind: 'table',
      connectionId: sourceConnectionId,
      database: sourceDatabase,
      table,
      engine: sourceConnection?.engine
    })
  }

  const openTargetTable = () => {
    setRightView({
      kind: 'table',
      connectionId: targetConnectionId,
      database: targetDatabase,
      table,
      engine: targetConnection?.engine
    })
  }

  const copySelectedRows = async () => {
    if (!targetState.data || sourceSelection.selectedCount === 0) return

    setCopying(true)

    const failedRowKeys = new Set<string>()
    let inserted = 0
    let failed = 0
    let firstError: string | null = null

    try {
      for (const [rowKey, row] of Object.entries(sourceSelection.selectedRows)) {
        const values = buildCopyValues(row, targetState.data.columns)
        if (Object.keys(values).length === 0) {
          failed += 1
          failedRowKeys.add(rowKey)
          if (!firstError) {
            firstError = t('diff.compareView.noSharedTargetCols')
          }
          continue
        }

        try {
          await unwrap(
            api.db.insertRow({
              connectionId: targetConnectionId,
              database: targetDatabase,
              table,
              values
            })
          )
          inserted += 1
        } catch (err) {
          failed += 1
          failedRowKeys.add(rowKey)
          if (!firstError) {
            firstError = (err as Error).message
          }
        }
      }

      if (inserted > 0) {
        setTargetReloadToken((current) => current + 1)
      }

      sourceSelection.removeSelectedKeys(
        new Set(Object.keys(sourceSelection.selectedRows).filter((rowKey) => !failedRowKeys.has(rowKey)))
      )

      showToast(
        failed > 0
          ? `${t('diff.compareView.copyMixed', { copied: inserted, failed })}${firstError ? `: ${firstError}` : ''}`
          : t('diff.compareView.copySuccess', { count: inserted }),
        failed > 0 ? 'error' : 'success'
      )
    } finally {
      setCopying(false)
    }
  }

  const deleteSelectedRows = async (side: 'source' | 'target') => {
    const selection = side === 'source' ? sourceSelection : targetSelection
    const state = side === 'source' ? sourceState : targetState
    const keyColumns = side === 'source' ? sourceKeyColumns : targetKeyColumns
    const connectionId = side === 'source' ? sourceConnectionId : targetConnectionId
    const database = side === 'source' ? sourceDatabase : targetDatabase
    const setState = side === 'source' ? setSourceState : setTargetState
    const bumpReloadToken = side === 'source' ? setSourceReloadToken : setTargetReloadToken

    if (!state.data || selection.selectedCount === 0) return
    if (!selection.selectionEnabled) {
      showToast(t('tableData.refuseNoPrimaryKey'), 'error')
      return
    }

    const confirmMessage =
      side === 'source'
        ? t('diff.compareView.confirmDeleteSelectedSourceRows', { count: selection.selectedCount })
        : t('diff.compareView.confirmDeleteSelectedTargetRows', { count: selection.selectedCount })
    if (!confirm(confirmMessage)) return

    setDeletingSide(side)

    try {
      const deletedRowKeys = new Set(Object.keys(selection.selectedRows))
      const pkRows = Object.values(selection.selectedRows).map((row) => pickPK(row, keyColumns))
      const result = await unwrap(
        api.db.deleteRows({
          connectionId,
          database,
          table,
          pkRows
        })
      )
      const affectedRows = (result as { affectedRows: number }).affectedRows

      selection.clearSelection()
      setState((current) => {
        if (!current.data) return current

        return {
          ...current,
          data: {
            ...current.data,
            rows: current.data.rows.filter((row) => {
              const rowKey = buildRowKey(row, current.data!.primaryKey)
              return !rowKey || !deletedRowKeys.has(rowKey)
            }),
            total: Math.max(0, current.data.total - affectedRows)
          }
        }
      })
      bumpReloadToken((current) => current + 1)

      showToast(
        t('diff.compareView.deleteSuccess', {
          count: affectedRows
        }),
        'success'
      )
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setDeletingSide(null)
    }
  }

  const overwriteTargetTable = async () => {
    if (!sourceState.data) return
    if (!confirm(t('diff.compareView.confirmOverwriteTargetTable', { table }))) return

    setOverwriting(true)

    try {
      const result = await unwrap(
        api.sync.execute(
          buildOverwriteTargetSyncRequest({
            sourceConnectionId,
            sourceDatabase,
            targetConnectionId,
            targetDatabase,
            table
          })
        )
      )

      sourceSelection.clearSelection()
      targetSelection.clearSelection()
      setTargetReloadToken((current) => current + 1)

      showToast(
        result.errors === 0
          ? t('diff.compareView.overwriteSuccess', { table })
          : t('diff.sync.executeResult', { executed: result.executed, errors: result.errors }),
        result.errors === 0 ? 'success' : 'error'
      )
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setOverwriting(false)
    }
  }

  const syncPaneScroll = (side: 'source' | 'target', event: UIEvent<HTMLDivElement>) => {
    if (syncingScrollRef.current) return

    const activeElement = event.currentTarget
    const peerElement = side === 'source' ? targetScrollRef.current : sourceScrollRef.current

    if (!peerElement) return

    syncingScrollRef.current = true
    syncComparePaneScroll(activeElement, peerElement)

    if (syncScrollFrameRef.current !== null) {
      cancelAnimationFrame(syncScrollFrameRef.current)
    }

    syncScrollFrameRef.current = requestAnimationFrame(() => {
      syncingScrollRef.current = false
      syncScrollFrameRef.current = null
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-border bg-card px-4 py-2">
        <div className="flex min-w-0 items-center gap-3 overflow-x-auto text-xs text-muted-foreground">
          {rowDiffNavigation.totalDiffTables > 0 && (
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3"
                disabled={!rowDiffNavigation.previousTable}
                onClick={() =>
                  rowDiffNavigation.previousTable && navigateToTable(rowDiffNavigation.previousTable)
                }
              >
                {t('diff.compareView.prevDiff')}
              </Button>
              <span className="tabular-nums">
                {rowDiffNavigation.currentDiffPosition === null
                  ? t('diff.compareView.diffsChanged', { count: rowDiffNavigation.totalDiffTables })
                  : t('diff.compareView.diffPos', {
                      pos: rowDiffNavigation.currentDiffPosition,
                      total: rowDiffNavigation.totalDiffTables
                    })}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3"
                disabled={!rowDiffNavigation.nextTable}
                onClick={() => rowDiffNavigation.nextTable && navigateToTable(rowDiffNavigation.nextTable)}
              >
                {t('diff.compareView.nextDiff')}
              </Button>
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Badge className="h-8 px-3 text-xs">
              {t('diff.compareView.selectedSource', { count: sourceSelection.selectedCount })}
            </Badge>
            <Button size="sm" variant="outline" onClick={refreshBoth}>
              <RefreshCw className="mr-1 h-4 w-4" /> {t('common.refresh')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={overwriteTargetTable}
              disabled={
                actionBusy ||
                sourceState.loading ||
                targetState.loading ||
                !sourceState.data
              }
            >
              <ArrowRight className="mr-1 h-4 w-4" />
              {overwriting
                ? t('diff.compareView.overwritingTargetTable')
                : t('diff.compareView.overwriteTargetTable')}
            </Button>
            <Button
              size="sm"
              onClick={copySelectedRows}
              disabled={
                actionBusy ||
                sourceSelection.selectedCount === 0 ||
                !sourceSelection.selectionEnabled ||
                !targetState.data ||
                targetState.loading
              }
            >
              <ArrowRight className="mr-1 h-4 w-4" />
              {copying ? t('diff.compareView.copying') : t('diff.compareView.copySelectedToTarget')}
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-amber-400/30 ring-1 ring-inset ring-amber-500/50" />
            {t('diff.compareView.legendChangedField')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-sky-500/20 ring-1 ring-inset ring-sky-500/40" />
            {t('diff.compareView.legendSourceOnly')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-violet-500/20 ring-1 ring-inset ring-violet-500/40" />
            {t('diff.compareView.legendTargetOnly')}
          </span>
        </div>
        {sourceState.data && !sourceState.data.hasPrimaryKey && (
          <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {t('diff.compareView.noPkCopyDisabled')}
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 xl:grid-cols-2">
        <TableComparePane
          title={t('diff.endpoint.source')}
          connectionName={sourceConnectionName}
          database={sourceDatabase}
          table={table}
          data={sourceState.data}
          error={sourceState.error}
          loading={sourceState.loading}
          scrollContainerRef={sourceScrollRef}
          onScroll={(event) => syncPaneScroll('source', event)}
          selectedKeys={sourceSelection.selectedKeySet}
          showSelection={sourceSelection.selectionEnabled}
          selectionEnabled={sourceSelection.selectionEnabled}
          onToggleAllVisible={sourceSelection.toggleAllVisible}
          allVisibleSelected={sourceSelection.allVisibleSelected}
          onToggleRow={sourceSelection.toggleRow}
          compareColumns={compareColumns}
          rowDiffByKey={rowDiffLookup?.source}
          alignedRows={alignedRows}
          side="source"
          selectedCount={sourceSelection.selectedCount}
          onOpenTable={openSourceTable}
          onDeleteSelected={() => void deleteSelectedRows('source')}
          deleting={deletingSide === 'source'}
        />

        <TableComparePane
          title={t('diff.endpoint.target')}
          connectionName={targetConnectionName}
          database={targetDatabase}
          table={table}
          data={targetState.data}
          error={targetState.error}
          loading={targetState.loading}
          scrollContainerRef={targetScrollRef}
          onScroll={(event) => syncPaneScroll('target', event)}
          leadingSpacer={sourceSelection.selectionEnabled && !targetSelection.selectionEnabled}
          selectedKeys={targetSelection.selectedKeySet}
          showSelection={targetSelection.selectionEnabled}
          selectionEnabled={targetSelection.selectionEnabled}
          onToggleAllVisible={targetSelection.toggleAllVisible}
          allVisibleSelected={targetSelection.allVisibleSelected}
          onToggleRow={targetSelection.toggleRow}
          compareColumns={compareColumns}
          rowDiffByKey={rowDiffLookup?.target}
          alignedRows={alignedRows}
          side="target"
          selectedCount={targetSelection.selectedCount}
          onOpenTable={openTargetTable}
          onDeleteSelected={() => void deleteSelectedRows('target')}
          deleting={deletingSide === 'target'}
        />
      </div>

      {(sourceState.data || targetState.data) && (
        <TableDataPagination
          totalRows={totalRows}
          page={page}
          totalPages={totalPages}
          pageDraft={pageDraft}
          pageSize={pageSize}
          hiddenColumnCount={0}
          onPageSizeChange={onPageSizeChange}
          onGoToPage={goToPage}
          onPageDraftChange={setPageDraft}
          onSubmitPageDraft={submitPageDraft}
          onResetPageDraft={() => setPageDraft(String(page))}
        />
      )}
    </div>
  )
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
