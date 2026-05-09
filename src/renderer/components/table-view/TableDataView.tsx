// 表数据视图：分页、where 过滤、排序、行 CRUD
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
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

interface Props {
  connectionId: string
  database: string
  table: string
  readOnly?: boolean
  filterEnabled?: boolean
  sortable?: boolean
}

export function TableDataView({
  connectionId,
  database,
  table,
  readOnly = false,
  filterEnabled = true,
  sortable = true
}: Props) {
  const { showToast } = useUIStore()
  const tableReloadToken = useUIStore(
    (state) => state.tableReloadTokens[`${connectionId}:${database}:${table}`] ?? 0
  )
  const { t } = useI18n()
  const [exportOpen, setExportOpen] = useState(false)
  const [columnPanelOpen, setColumnPanelOpen] = useState(false)

  const {
    data,
    loading,
    page,
    pageDraft,
    pageSize,
    where,
    appliedWhere,
    orderBy,
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
    selectionShiftPressedRef,
    setEditing,
    onToggleSelect,
    onToggleSelectPage,
    onClearSelection,
    onCopySelectedRows,
    onRowClick,
    onDeleteSelected,
    selectedRows,
    exportScopes,
    allRowsOnPageSelected,
    someRowsOnPageSelected,
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

  return (
    <div className="flex flex-col h-full">
      <TableDataToolbar
        where={where}
        hasPendingWhere={hasPendingWhere}
        hasActiveFilter={Boolean(where || appliedWhere)}
        loading={loading}
        selectedCount={selected.size}
        wrapCells={wrapCells}
        density={density}
        readOnly={readOnly}
        filterEnabled={filterEnabled}
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
        onToggleDensity={() =>
          setDensity((current) => (current === 'compact' ? 'comfortable' : 'compact'))
        }
        onInsert={() => setEditing({ mode: 'insert' })}
        onDeleteSelected={onDeleteSelected}
        onCopySelectedRows={onCopySelectedRows}
        onClearSelection={onClearSelection}
      />

      {data && !data.hasPrimaryKey && !readOnly && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/30 text-amber-300 text-xs">
          <AlertTriangle className="w-3.5 h-3.5" />
          {t('tableData.noPrimaryKeyHint')}
        </div>
      )}

      <TableDataGrid
        data={data}
        loading={loading}
        visibleColumns={visibleDataColumns}
        orderBy={orderBy}
        density={density}
        wrapCells={wrapCells}
        selected={selected}
        allRowsOnPageSelected={allRowsOnPageSelected}
        someRowsOnPageSelected={someRowsOnPageSelected}
        readOnly={readOnly}
        sortable={sortable}
        selectionShiftPressedRef={selectionShiftPressedRef}
        onToggleSelectPage={onToggleSelectPage}
        onSort={onSort}
        onRowClick={onRowClick}
        onStartEdit={(row) => {
          if (!readOnly) setEditing({ mode: 'edit', row })
        }}
        onToggleSelect={onToggleSelect}
      />

      {data && (
        <TableDataPagination
          totalRows={data.total}
          page={page}
          totalPages={totalPages}
          pageDraft={pageDraft}
          pageSize={pageSize}
          hiddenColumnCount={hiddenColumnCount}
          onPageSizeChange={onPageSizeChange}
          onGoToPage={goToPage}
          onPageDraftChange={setPageDraft}
          onSubmitPageDraft={submitPageDraft}
          onResetPageDraft={() => setPageDraft(String(page))}
        />
      )}

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
          orderBy={orderBy}
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
