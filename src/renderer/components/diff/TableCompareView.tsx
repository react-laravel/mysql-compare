// Side-by-side table compare (blueprint §2.4 / §3.6).
//
// Chunk 10 rebuilt the chrome and the destructive paths:
//   · the ad-hoc header band → `TableCompareToolbar` on the shared `Toolbar`
//     (one primary action, one `⋯`, a legend/warning filters row, progress on
//     the bottom edge);
//   · the `grid xl:grid-cols-2` → `TableComparePanes` on `SplitPane`, synced
//     scroll preserved;
//   · both native `confirm()` calls (delete selected rows, overwrite target
//     table) → one `ConfirmDialog tone="danger"` naming the object in mono;
//   · the overwrite registers a `job-store` entry, so leaving the tab still
//     shows it in the status bar and on the tab's status dot (§2.10).
//
// Loading, alignment and selection live in `table-compare-data-hooks`; this
// file is layout plus the four verbs.
import { useEffect, useMemo, useState } from 'react'
import { api, unwrap } from '@renderer/lib/api'
import { ConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { useAppAction } from '@renderer/lib/app-actions'
import { pickPK } from '@renderer/lib/utils'
import { jobs } from '@renderer/store/job-store'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSettingsStore } from '@renderer/store/settings-store'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import { getRowDiffNavigation } from './diff-panel-utils'
import { useTableCompareModel } from './table-compare-data-hooks'
import {
  buildCopyValues,
  buildOverwriteTargetSyncRequest,
  buildRowKey
} from './table-compare-utils'
import { buildTableCompareView } from './table-compare-session'
import { TableComparePanes } from './TableComparePanes'
import { TableCompareToolbar } from './TableCompareToolbar'
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
  /** the workspace keeps every tab mounted; only the visible one owns ⌘R */
  active?: boolean
}

type CompareSide = 'source' | 'target'

/** Which destructive action the one `ConfirmDialog` is currently asking about. */
type PendingConfirm =
  | { kind: 'delete-rows'; side: CompareSide; count: number }
  | { kind: 'overwrite-target' }

export function TableCompareView({
  compareSessionId,
  sourceConnectionId,
  sourceDatabase,
  targetConnectionId,
  targetDatabase,
  table,
  comparedTables,
  diffTables,
  active = true
}: Props) {
  const connections = useConnectionStore((state) => state.connections)
  const setRightView = useUIStore((state) => state.setRightView)
  const showToast = useUIStore((state) => state.showToast)
  const defaultPageSize = useSettingsStore((state) => state.defaultPageSize)
  const { t } = useI18n()

  const [page, setPage] = useState(1)
  const [pageDraft, setPageDraft] = useState('1')
  const [pageSize, setPageSize] = useState(defaultPageSize)
  const [copying, setCopying] = useState(false)
  const [overwriting, setOverwriting] = useState(false)
  const [deletingSide, setDeletingSide] = useState<CompareSide | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)

  const model = useTableCompareModel({
    sourceConnectionId,
    sourceDatabase,
    targetConnectionId,
    targetDatabase,
    table,
    page,
    pageSize,
    comparedTables,
    diffTables
  })
  const {
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
    reloadBoth
  } = model

  useEffect(() => {
    setPage(1)
    setPageDraft('1')
  }, [sourceConnectionId, sourceDatabase, targetConnectionId, targetDatabase, table])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalRows / pageSize)), [pageSize, totalRows])

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  useEffect(() => {
    setPageDraft(String(page))
  }, [page])

  const goToPage = (nextPage: number) => {
    setPage(Math.max(1, Math.min(totalPages, nextPage)))
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
  const loading = sourceState.loading || targetState.loading

  // ⌘R re-reads both sides (§4.2 scopes ⌘R to grids). Released while an action
  // is in flight so a refresh cannot race a copy/delete/overwrite.
  useAppAction('refresh-view', active && !actionBusy ? reloadBoth : null)

  const sourceConnection = connections.find((connection) => connection.id === sourceConnectionId) ?? null
  const targetConnection = connections.find((connection) => connection.id === targetConnectionId) ?? null
  const sourceConnectionName = sourceConnection?.name ?? sourceConnectionId
  const targetConnectionName = targetConnection?.name ?? targetConnectionId
  const sourceLabel = `${sourceConnectionName} / ${sourceDatabase}`
  const targetLabel = `${targetConnectionName} / ${targetDatabase}`

  const navigateToTable = (nextTable: string) => {
    setRightView(
      buildTableCompareView(
        {
          sourceConnectionId,
          sourceDatabase,
          targetConnectionId,
          targetDatabase,
          table: nextTable
        },
        { comparedTables, diffTables }
      )
    )
  }

  const openTable = (side: CompareSide) => {
    setRightView({
      kind: 'table',
      connectionId: side === 'source' ? sourceConnectionId : targetConnectionId,
      database: side === 'source' ? sourceDatabase : targetDatabase,
      table,
      engine: (side === 'source' ? sourceConnection : targetConnection)?.engine
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
        reloadTarget()
      }

      sourceSelection.removeSelectedKeys(
        new Set(
          Object.keys(sourceSelection.selectedRows).filter((rowKey) => !failedRowKeys.has(rowKey))
        )
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

  /**
   * Blueprint §2.8: the confirmation is a `ConfirmDialog`, and the guard that
   * used to sit *after* the native `confirm()` (refusing a keyless table) now
   * runs before it — a dialog the app was always going to refuse is a lie.
   */
  const requestDeleteSelectedRows = (side: CompareSide) => {
    const selection = side === 'source' ? sourceSelection : targetSelection
    if (selection.selectedCount === 0) return
    if (!selection.selectionEnabled) {
      showToast(t('tableData.refuseNoPrimaryKey'), 'error')
      return
    }
    setPendingConfirm({ kind: 'delete-rows', side, count: selection.selectedCount })
  }

  const deleteSelectedRows = async (side: CompareSide) => {
    const selection = side === 'source' ? sourceSelection : targetSelection
    const state = side === 'source' ? sourceState : targetState
    const keyColumns = side === 'source' ? sourceKeyColumns : targetKeyColumns
    const connectionId = side === 'source' ? sourceConnectionId : targetConnectionId
    const database = side === 'source' ? sourceDatabase : targetDatabase
    const setState = side === 'source' ? setSourceState : setTargetState
    const reloadSide = side === 'source' ? reloadSource : reloadTarget

    if (!state.data || selection.selectedCount === 0) return
    if (!selection.selectionEnabled) return

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
      reloadSide()

      showToast(t('diff.compareView.deleteSuccess', { count: affectedRows }), 'success')
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setDeletingSide(null)
    }
  }

  const overwriteTargetTable = async () => {
    if (!sourceState.data) return

    setOverwriting(true)
    // `sync.execute` has no cancel channel (blueprint risk 6), so the job is
    // registered without `onCancel` — visible progress, no fake Cancel.
    const jobId = jobs.start({
      kind: 'sync',
      label: t('diff.compareView.overwriteJobLabel', { table }),
      tabId: `table-compare:${compareSessionId}`
    })

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
      reloadTarget()

      jobs.finish(jobId, { status: result.errors === 0 ? 'done' : 'error' })
      showToast(
        result.errors === 0
          ? t('diff.compareView.overwriteSuccess', { table })
          : t('diff.sync.executeResult', { executed: result.executed, errors: result.errors }),
        result.errors === 0 ? 'success' : 'error'
      )
    } catch (err) {
      jobs.finish(jobId, { status: 'error', detail: (err as Error).message })
      showToast((err as Error).message, 'error')
    } finally {
      setOverwriting(false)
    }
  }

  const runPendingConfirm = async () => {
    const request = pendingConfirm
    if (!request) return
    if (request.kind === 'overwrite-target') {
      await overwriteTargetTable()
      return
    }
    await deleteSelectedRows(request.side)
  }

  const confirmSide = pendingConfirm?.kind === 'delete-rows' ? pendingConfirm.side : null
  const overwriteConfirm = pendingConfirm?.kind === 'overwrite-target'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <TableCompareToolbar
        table={table}
        sourceLabel={sourceLabel}
        targetLabel={targetLabel}
        progress={
          loading
            ? { status: 'running', label: t('common.loading') }
            : actionBusy
              ? { status: 'running', label: t('diff.compareView.actionRunning') }
              : null
        }
        sourceSelectedCount={sourceSelection.selectedCount}
        targetSelectedCount={targetSelection.selectedCount}
        copyEnabled={
          !actionBusy &&
          sourceSelection.selectedCount > 0 &&
          sourceSelection.selectionEnabled &&
          Boolean(targetState.data) &&
          !targetState.loading
        }
        copying={copying}
        actionBusy={actionBusy}
        sourceHasPrimaryKey={sourceState.data ? sourceState.data.hasPrimaryKey : true}
        pageSize={pageSize}
        diffNavigation={rowDiffNavigation}
        onCopySelected={() => void copySelectedRows()}
        onOverwriteTarget={() => setPendingConfirm({ kind: 'overwrite-target' })}
        onDeleteSelected={requestDeleteSelectedRows}
        onReloadBoth={reloadBoth}
        onNavigateToTable={navigateToTable}
        onPageSizeChange={onPageSizeChange}
      />

      <TableComparePanes
        table={table}
        scrollResetKey={`${sourceConnectionId}:${sourceDatabase}:${targetConnectionId}:${targetDatabase}:${table}:${page}`}
        compareColumns={compareColumns}
        rowDiffLookup={rowDiffLookup}
        alignedRows={alignedRows}
        source={{
          connectionName: sourceConnectionName,
          database: sourceDatabase,
          data: sourceState.data,
          error: sourceState.error,
          loading: sourceState.loading,
          selection: sourceSelection,
          onRetry: reloadSource,
          onOpenTable: () => openTable('source')
        }}
        target={{
          connectionName: targetConnectionName,
          database: targetDatabase,
          data: targetState.data,
          error: targetState.error,
          loading: targetState.loading,
          selection: targetSelection,
          onRetry: reloadTarget,
          onOpenTable: () => openTable('target')
        }}
      />

      {(sourceState.data || targetState.data) && (
        <TableDataPagination
          totalRows={totalRows}
          page={page}
          totalPages={totalPages}
          pageDraft={pageDraft}
          hiddenColumnCount={0}
          onGoToPage={goToPage}
          onPageDraftChange={setPageDraft}
          onSubmitPageDraft={submitPageDraft}
          onResetPageDraft={() => setPageDraft(String(page))}
        />
      )}

      <ConfirmDialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null)
        }}
        tone="danger"
        title={
          overwriteConfirm
            ? t('diff.compareView.confirmOverwriteTitle')
            : t('diff.compareView.confirmDeleteTitle', { count: pendingConfirm?.count ?? 0 })
        }
        body={
          overwriteConfirm
            ? t('diff.compareView.confirmOverwriteBody')
            : confirmSide === 'source'
              ? t('diff.compareView.confirmDeleteSourceBody')
              : t('diff.compareView.confirmDeleteTargetBody')
        }
        subject={
          overwriteConfirm || confirmSide === 'target'
            ? `${targetLabel} / ${table}`
            : `${sourceLabel} / ${table}`
        }
        consequence={
          overwriteConfirm
            ? t('diff.compareView.confirmOverwriteConsequence')
            : t('common.cannotBeUndone')
        }
        cancelLabel={t('common.cancel')}
        confirmLabel={
          overwriteConfirm
            ? t('diff.compareView.overwriteTargetTable')
            : t('diff.compareView.deleteSelectedRows', { count: pendingConfirm?.count ?? 0 })
        }
        onConfirm={runPendingConfirm}
      />
    </div>
  )
}
