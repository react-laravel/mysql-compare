// 表数据视图：分页、where 过滤、排序、行 CRUD
//
// Blueprint §3.1 / §2.6: two chrome bands plus a filters row instead of five.
// The Data/Structure/Info switch arrives as `tabs` and lives inside the
// toolbar, so it costs zero vertical pixels.
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { api, unwrap } from '@renderer/lib/api'
import { ConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import type { MenuItem } from '@renderer/components/ui/dropdown-menu'
import { useSidebarActions } from '@renderer/components/layout/sidebar-actions'
import { buildTableMenuItems } from '@renderer/components/layout/sidebar-menus'
import { useAppAction } from '@renderer/lib/app-actions'
import { pickPK } from '@renderer/lib/utils'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import { ExportTableDialog } from './ExportTableDialog'
import { RowEditDialog } from './RowEditDialog'
import { TableColumnPanelDialog } from './TableColumnPanelDialog'
import { TableDataGrid } from './TableDataGrid'
import { TableDataPagination } from './TableDataPagination'
import { TableDataToolbar } from './TableDataToolbar'
import { useTableDataQuery } from './table-data-query-hooks'
import { useTableDataRowActions } from './table-data-row-hooks'
import { buildRowInsertSQL } from './table-row-insert-sql'
import type { DbEngine } from '../../../shared/types'

interface Props {
  connectionId: string
  database: string
  table: string
  engine?: DbEngine
  readOnly?: boolean
  filterEnabled?: boolean
  sortable?: boolean
  exportEnabled?: boolean
  /** the Data / Structure / Info pill `Tabs` owned by the workspace */
  tabs?: ReactNode
  /** false for a background tab: ⌘F / ⌘R must reach the visible view only */
  active?: boolean
}

export function TableDataView({
  connectionId,
  database,
  table,
  engine = 'mysql',
  readOnly = false,
  filterEnabled = true,
  sortable = true,
  exportEnabled = true,
  tabs,
  active = true
}: Props) {
  const { showToast } = useUIStore()
  const tableReloadToken = useUIStore(
    (state) => state.tableReloadTokens[`${connectionId}:${database}:${table}`] ?? 0
  )
  const { t } = useI18n()
  const actions = useSidebarActions()
  const connection = useConnectionStore((state) =>
    state.connections.find((item) => item.id === connectionId)
  )
  const [exportOpen, setExportOpen] = useState(false)
  const [columnPanelOpen, setColumnPanelOpen] = useState(false)
  const filterInputRef = useRef<HTMLInputElement | null>(null)

  const {
    data,
    loading,
    error,
    page,
    pageDraft,
    pageSize,
    where,
    appliedWhere,
    effectiveOrderBy,
    visibleColumns,
    wrapCells,
    density,
    totalPages,
    visibleDataColumns,
    hiddenColumnCount,
    hasPendingWhere,
    setWhere,
    setPageDraft,
    onPageSizeChange,
    setWrapCells,
    setDensity,
    setVisibleColumns,
    refresh,
    applyWhere,
    clearWhere,
    goToPage,
    submitPageDraft,
    setColumnVisibility,
    onSort
  } = useTableDataQuery({
    connectionId,
    database,
    table,
    tableReloadToken,
    showToast
  })
  const {
    selected,
    editing: rowEditing,
    pendingDelete,
    setEditing,
    onToggleSelect,
    onToggleSelectPage,
    onClearSelection,
    onCopySelectedRows,
    onRowClick,
    onDeleteSelected,
    requestDeleteRows,
    cancelDeleteRows,
    confirmDeleteRows,
    selectedRows,
    exportScopes,
    submitEditing
  } = useTableDataRowActions({
    connectionId,
    database,
    table,
    data,
    showToast,
    t,
    refresh
  })

  // ⌘F and ⌘R are global keys with contextual targets; a background tab must
  // register `null` or it would answer for the foreground one.
  useAppAction('focus-filter', active && filterEnabled ? () => filterInputRef.current?.focus() : null)
  useAppAction('refresh-view', active ? refresh : null)
  // Columns and Export left the toolbar for the `⋯`; the palette keeps them one
  // keystroke away (blueprint §5, risk 5).
  useAppAction('open-column-picker', active && data ? () => setColumnPanelOpen(true) : null)
  useAppAction(
    'export-current-view',
    active && !readOnly && exportEnabled ? () => setExportOpen(true) : null
  )

  const saveJsonCell = async (row: Record<string, unknown>, column: string, value: string) => {
    if (!data?.hasPrimaryKey) {
      const message = t('tableData.refuseNoPrimaryKey')
      showToast(message, 'error')
      throw new Error(message)
    }

    await unwrap(
      api.db.updateRow({
        connectionId,
        database,
        table,
        pkValues: pickPK(row, data.primaryKey),
        changes: { [column]: value }
      })
    )
    showToast(t('tableData.rowUpdated'), 'success')
    refresh()
  }

  const buildInsertSQL = (row: Record<string, unknown>, includeId: boolean): string | null => {
    if (!data || engine === 'redis') return null
    return buildRowInsertSQL({ engine, database, table, columns: data.columns, row, includeId })
  }

  const copyRowAsInsert = async (row: Record<string, unknown>, includeId: boolean) => {
    const sql = buildInsertSQL(row, includeId)
    if (!sql) return
    try {
      await navigator.clipboard.writeText(sql)
      showToast(t('tableData.insertCopied'), 'success')
    } catch (caught) {
      showToast((caught as Error).message, 'error')
    }
  }

  const copySelectedAsInsert = async () => {
    if (selectedRows.length === 0) return
    const statements = selectedRows.flatMap((row) => {
      const sql = buildInsertSQL(row, true)
      return sql ? [sql] : []
    })
    if (statements.length === 0) return
    try {
      await navigator.clipboard.writeText(statements.join('\n'))
      showToast(t('tableData.insertCopied'), 'success')
    } catch (caught) {
      showToast((caught as Error).message, 'error')
    }
  }

  // Blueprint §2.8: the toolbar `⋯`, the tree row `⋯` and the right-click menu
  // all render the *same* builder, so rename / copy / truncate / drop can never
  // drift between the two surfaces.
  const objectItems = useMemo<MenuItem[]>(() => {
    if (!connection) return []
    return buildTableMenuItems({ connection, database, table, t, actions }).filter(
      (item) => !('id' in item) || (item.id !== 'details' && item.id !== 'export' && item.id !== 'sep-1')
    )
  }, [actions, connection, database, t, table])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <TableDataToolbar
        table={table}
        database={database}
        connectionName={connection?.name}
        engine={engine}
        tabs={tabs}
        where={where}
        hasPendingWhere={hasPendingWhere}
        hasActiveFilter={Boolean(where || appliedWhere)}
        loading={loading}
        selectedCount={selected.size}
        totalRows={data?.total}
        hasPrimaryKey={data?.hasPrimaryKey ?? true}
        wrapCells={wrapCells}
        density={density}
        pageSize={pageSize}
        readOnly={readOnly}
        filterEnabled={filterEnabled}
        exportEnabled={exportEnabled}
        objectItems={objectItems}
        filterInputRef={filterInputRef}
        columnCounts={
          data
            ? {
                visible: visibleDataColumns.length,
                total: data.columns.length
              }
            : undefined
        }
        onWhereChange={setWhere}
        onApplyWhere={applyWhere}
        onClearWhere={clearWhere}
        onRefresh={refresh}
        onOpenExport={() => setExportOpen(true)}
        onOpenColumnPanel={() => setColumnPanelOpen(true)}
        onToggleWrapCells={() => setWrapCells((current) => !current)}
        onSetDensity={setDensity}
        onPageSizeChange={onPageSizeChange}
        onInsert={() => setEditing({ mode: 'insert' })}
        onDeleteSelected={onDeleteSelected}
        onCopySelectedRows={onCopySelectedRows}
        onCopySelectedAsInsert={engine === 'redis' ? undefined : copySelectedAsInsert}
        onClearSelection={onClearSelection}
      />

      <TableDataGrid
        data={data}
        error={error}
        visibleColumns={visibleDataColumns}
        orderBy={effectiveOrderBy}
        density={density}
        wrapCells={wrapCells}
        selected={selected}
        readOnly={readOnly}
        sortable={sortable}
        hasActiveFilter={Boolean(appliedWhere)}
        activeFilter={appliedWhere}
        onSort={onSort}
        onToggleSelectPage={onToggleSelectPage}
        onRowClick={onRowClick}
        onStartEdit={(row) => {
          if (!readOnly) setEditing({ mode: 'edit', row })
        }}
        onToggleSelect={onToggleSelect}
        onDeleteRows={readOnly ? undefined : requestDeleteRows}
        onCopyInsert={engine === 'redis' ? undefined : copyRowAsInsert}
        onSaveJsonCell={readOnly ? undefined : saveJsonCell}
        onClearFilter={clearWhere}
        onInsert={() => setEditing({ mode: 'insert' })}
        onRetry={refresh}
      />

      {data && (
        <TableDataPagination
          totalRows={data.total}
          page={page}
          totalPages={totalPages}
          pageDraft={pageDraft}
          hiddenColumnCount={hiddenColumnCount}
          onGoToPage={goToPage}
          onPageDraftChange={setPageDraft}
          onSubmitPageDraft={submitPageDraft}
          onResetPageDraft={() => setPageDraft(String(page))}
        />
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open) cancelDeleteRows()
        }}
        tone="danger"
        title={t('tableData.confirmDeleteTitle')}
        body={t('tableData.confirmDeleteRows', { count: pendingDelete?.length ?? 0 })}
        subject={`${database}.${table}`}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        onConfirm={confirmDeleteRows}
      />

      {!readOnly && rowEditing && data && (
        <RowEditDialog
          mode={rowEditing.mode}
          columns={data.columns}
          primaryKey={data.primaryKey}
          row={rowEditing.row}
          onClose={() => setEditing(null)}
          onSubmit={submitEditing}
        />
      )}

      {!readOnly && exportOpen && (
        <ExportTableDialog
          open
          onOpenChange={setExportOpen}
          connectionId={connectionId}
          database={database}
          table={table}
          where={appliedWhere || undefined}
          orderBy={effectiveOrderBy}
          page={page}
          pageSize={pageSize}
          availableScopes={exportScopes}
          selectedRows={selectedRows}
        />
      )}

      {columnPanelOpen && data && (
        <TableColumnPanelDialog
          open
          columns={data.columns}
          visibleColumns={visibleColumns}
          visibleColumnCount={visibleDataColumns.length}
          onOpenChange={setColumnPanelOpen}
          onShowAllColumns={() => setVisibleColumns(new Set(data.columns.map((column) => column.name)))}
          onShowPrimaryColumns={() => {
            const primaryColumns = data.columns.filter((column) => column.isPrimaryKey)
            if (primaryColumns.length === 0) return
            setVisibleColumns(new Set(primaryColumns.map((column) => column.name)))
          }}
          onToggleColumn={setColumnVisibility}
        />
      )}
    </div>
  )
}
