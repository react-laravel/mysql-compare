// The data grid (blueprint §3.1).
//
// This used to be a hand-built `<Table>` with its own context menu, its own
// select-all bookkeeping and mouse-only rows. It is now `DataTable
// variant="grid"`, which brings the sticky header, the indeterminate select-all
// `Checkbox`, keyboard-reachable rows (`Enter` opens the row editor — the old
// grid had no keyboard path to it at all), the 300ms skeleton and the shared
// `ContextMenu`.
import { useMemo } from 'react'
import { Copy, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { DataTable, type Column, type DataTableSort } from '@renderer/components/ui/data-table'
import type { MenuItem } from '@renderer/components/ui/dropdown-menu'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { useI18n } from '@renderer/i18n'
import { cn, formatCellValue } from '@renderer/lib/utils'
import type { ColumnInfo, QueryRowsResult } from '../../../shared/types'
import { JsonViewerTrigger } from './JsonViewerTrigger'
import { getFormattedJsonDisplay } from './row-edit-dialog-utils'
import { renderTableCellValue } from './table-cell-render'

type Row = Record<string, unknown>

interface TableDataGridProps {
  data: QueryRowsResult | null
  error?: Error | null
  visibleColumns: ColumnInfo[]
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
  density: 'compact' | 'comfortable'
  wrapCells: boolean
  selected: Set<number>
  readOnly?: boolean
  sortable?: boolean
  /** drives which empty state the body shows */
  hasActiveFilter?: boolean
  activeFilter?: string
  onSort: (column: string) => void
  /** the header checkbox: select every row on the page, or clear the page */
  onToggleSelectPage: () => void
  onRowClick: (rowIndex: number, shiftKey: boolean) => void
  onStartEdit: (row: Row) => void
  onToggleSelect: (rowIndex: number, shiftKey: boolean) => void
  onDeleteRows?: (rowIndexes: number[]) => void
  onCopyInsert?: (row: Row, includeId: boolean) => void
  onSaveJsonCell?: (row: Row, column: string, value: string) => Promise<void>
  onClearFilter?: () => void
  onInsert?: () => void
  onRetry?: () => void
}

const STICKY_SELECT_WIDTH = 32
/** The sticky cells sit above the row wash, so they re-state it themselves. */
const STICKY_CELL = 'bg-canvas group-hover:bg-hover group-aria-[selected=true]:bg-selected'

export function TableDataGrid({
  data,
  error,
  visibleColumns,
  orderBy,
  density,
  wrapCells,
  selected,
  readOnly = false,
  sortable = true,
  hasActiveFilter = false,
  activeFilter,
  onSort,
  onToggleSelectPage,
  onRowClick,
  onStartEdit,
  onToggleSelect,
  onDeleteRows,
  onCopyInsert,
  onSaveJsonCell,
  onClearFilter,
  onInsert,
  onRetry
}: TableDataGridProps) {
  const { t } = useI18n()
  const hasPrimaryKey = data?.hasPrimaryKey ?? false

  const columns = useMemo<Column<Row>[]>(() => {
    const editColumn: Column<Row>[] = readOnly
      ? []
      : [
          {
            id: '__edit',
            header: <span className="sr-only">{t('tableData.editRow')}</span>,
            sticky: 'left',
            stickyOffset: STICKY_SELECT_WIDTH,
            width: STICKY_SELECT_WIDTH,
            headerClassName: 'w-8',
            cellClassName: cn('w-8', STICKY_CELL),
            cell: (row) => (
              <button
                type="button"
                className="text-fg-muted hover:text-fg disabled:opacity-50"
                disabled={!hasPrimaryKey}
                aria-label={hasPrimaryKey ? t('tableData.editRow') : t('tableData.noPk')}
                title={hasPrimaryKey ? t('tableData.editRow') : t('tableData.noPk')}
                onClick={(event) => {
                  event.stopPropagation()
                  onStartEdit(row)
                }}
              >
                <Pencil aria-hidden strokeWidth={1.75} className="size-3" />
              </button>
            )
          }
        ]

    return [
      ...editColumn,
      ...visibleColumns.map<Column<Row>>((column) => ({
        id: column.name,
        sortable,
        headerClassName: 'whitespace-normal align-bottom',
        cellClassName: wrapCells
          ? 'max-w-md whitespace-pre-wrap break-words align-top'
          : 'max-w-xs truncate',
        title: (row) => formatCellValue(row[column.name]),
        header: (
          <span className="flex flex-col items-start gap-0.5 py-1 leading-tight">
            <span className="flex flex-wrap items-center gap-1">
              {column.isPrimaryKey ? <Badge tone="warning">PK</Badge> : null}
              <span className="whitespace-nowrap">{column.name}</span>
              <span className="text-2xs font-normal text-fg-subtle">{column.type}</span>
            </span>
            {column.comment ? (
              <span className="max-w-56 truncate text-2xs font-normal text-warning-text" title={column.comment}>
                {column.comment}
              </span>
            ) : null}
          </span>
        ),
        cell: (row) => {
          const json = getFormattedJsonDisplay(row[column.name])
          return (
            <span className="flex min-w-0 items-start gap-1.5">
              <span className={cn('min-w-0', wrapCells ? 'whitespace-pre-wrap break-words' : 'truncate')}>
                {renderTableCellValue(row[column.name], column)}
              </span>
              {json ? (
                <JsonViewerTrigger
                  column={column}
                  row={row}
                  content={json}
                  readOnly={readOnly}
                  onSave={hasPrimaryKey ? onSaveJsonCell : undefined}
                />
              ) : null}
            </span>
          )
        }
      }))
    ]
  }, [
    hasPrimaryKey,
    onSaveJsonCell,
    onStartEdit,
    readOnly,
    sortable,
    t,
    visibleColumns,
    wrapCells
  ])

  // `Set<number>` is the grid's model; `DataTable` speaks `Set<string>` keys.
  const selectedKeys = useMemo(() => new Set(Array.from(selected, String)), [selected])

  const sort = useMemo<DataTableSort | null>(
    () => (orderBy ? { columnId: orderBy.column, direction: orderBy.dir === 'ASC' ? 'asc' : 'desc' } : null),
    [orderBy]
  )

  const rowMenu = (row: Row, index: number): MenuItem[] => {
    const items: MenuItem[] = []
    if (onCopyInsert) {
      items.push(
        {
          id: 'copy-insert-with-id',
          icon: Copy,
          label: t('tableData.copyInsertWithId'),
          onSelect: () => onCopyInsert(row, true)
        },
        {
          id: 'copy-insert-without-id',
          icon: Copy,
          label: t('tableData.copyInsertWithoutId'),
          onSelect: () => onCopyInsert(row, false)
        }
      )
    }
    if (!readOnly) {
      items.push({
        id: 'edit-row',
        icon: Pencil,
        label: t('tableData.editRow'),
        disabled: !hasPrimaryKey,
        disabledReason: t('tableData.noPk'),
        onSelect: () => onStartEdit(row)
      })
      if (onDeleteRows) {
        items.push({
          id: 'delete-row',
          icon: Trash2,
          label: t('tableData.deleteRow'),
          danger: true,
          disabled: !hasPrimaryKey,
          disabledReason: t('tableData.noPk'),
          onSelect: () => onDeleteRows([index])
        })
      }
    }
    return items
  }

  if (error) {
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <EmptyState
          variant="error"
          title={t('tableData.loadFailed')}
          description={(error as Error).message}
          error={error}
          detailsLabel={t('common.details')}
          action={
            <Button variant="primary" icon={RefreshCw} onClick={onRetry}>
              {t('common.retry')}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <DataTable<Row>
      className="min-h-0 flex-1"
      aria-label={t('tableData.grid')}
      variant="grid"
      density={density}
      columns={columns}
      rows={data?.rows ?? []}
      rowKey={(_row, index) => String(index)}
      // "No data yet" is loading, not empty: rendering the empty state before
      // the first query resolves flashes "this table has no rows".
      // `Skeleton` waits 300ms on its own, so a fast query shows nothing.
      loading={!data}
      sort={sort}
      // `DataTable` already applied its asc → desc → none cycle, which is the
      // same cycle `useTableDataQuery.onSort` runs, so replaying the column is
      // enough to land on `next`.
      onSortChange={
        sortable
          ? (next) => {
              const columnId = next?.columnId ?? sort?.columnId
              if (columnId) onSort(columnId)
            }
          : undefined
      }
      selection={
        readOnly
          ? undefined
          : {
              selected: selectedKeys,
              selectAllLabel: t('tableData.selectPageRows'),
              isDisabled: () => !hasPrimaryKey,
              label: (_row, index) => t('tableData.selectRow', { index: index + 1 }),
              onToggle: (_row, index, shiftKey) => onToggleSelect(index, shiftKey),
              // Only the header checkbox reaches `onChange`; per-row toggles go
              // through `onToggle` so Shift+click can extend a range.
              onChange: () => onToggleSelectPage()
            }
      }
      onRowClick={readOnly ? undefined : (_row, index, event) => onRowClick(index, event.shiftKey)}
      onRowActivate={readOnly || !hasPrimaryKey ? undefined : (row) => onStartEdit(row)}
      activateOn="double-click"
      onRowContextMenu={readOnly ? undefined : rowMenu}
      rowClassName={() => 'group'}
      empty={
        hasActiveFilter ? (
          <EmptyState
            variant="no-results"
            title={t('tableData.noRowsMatched')}
            description={activeFilter ? <code className="font-mono">{activeFilter}</code> : undefined}
            action={
              <Button variant="secondary" onClick={onClearFilter}>
                {t('tableData.clearFilter')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            variant="first-run"
            title={t('tableData.noRowsYet')}
            action={
              !readOnly && onInsert ? (
                <Button variant="primary" icon={Plus} onClick={onInsert}>
                  {t('common.insert')}
                </Button>
              ) : (
                <Button variant="secondary" icon={RefreshCw} onClick={onRetry}>
                  {t('common.refresh')}
                </Button>
              )
            }
          />
        )
      }
    />
  )
}
