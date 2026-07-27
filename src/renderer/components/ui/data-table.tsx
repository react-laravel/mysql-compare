import * as React from 'react'
import { cn } from '@renderer/lib/utils'
import type { Tone } from './badge'
import { Checkbox } from './checkbox'
import { ContextMenu, useContextMenu } from './context-menu'
import type { MenuItem } from './dropdown-menu'
import { Skeleton } from './skeleton'
import {
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  type SortDirection,
  type TableDensity,
  type TableVariant
} from './table'

export interface Column<Row> {
  id: string
  header: React.ReactNode
  cell: (row: Row, index: number) => React.ReactNode
  width?: number
  minWidth?: number
  align?: 'left' | 'right'
  sortable?: boolean
  sticky?: 'left' | 'right'
  /**
   * px offset for a *second* sticky column in the same direction — without it
   * two `sticky="left"` columns both land on `left-0` and overlap. The data
   * grid stacks a select column and an edit column.
   */
  stickyOffset?: number
  mono?: boolean
  /** opt-in; the shared Td no longer clamps to max-w-xs */
  truncate?: boolean
  /** per-column cell overrides (cell wrapping in the data grid) */
  cellClassName?: string
  /** per-column header overrides (the data grid's two-line column headers) */
  headerClassName?: string
  /** plain text used for the cell's `title` tooltip */
  title?: (row: Row) => string | undefined
}

export interface DataTableSort {
  columnId: string
  direction: SortDirection
}

export interface DataTableProps<Row> {
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  variant?: TableVariant
  density?: TableDensity
  sort?: DataTableSort | null
  onSortChange?: (sort: DataTableSort | null) => void
  selection?: {
    selected: Set<string>
    onChange: (next: Set<string>) => void
    mode?: 'single' | 'multi'
    isDisabled?: (row: Row) => boolean
    label?: (row: Row, index: number) => string
    selectAllLabel?: string
    /**
     * Takes over the per-row checkbox so the owner can implement Shift+click
     * range selection (the plain `onChange` contract cannot carry the
     * modifier). `onChange` still drives select-all.
     */
    onToggle?: (row: Row, index: number, shiftKey: boolean) => void
  }
  /** click + Enter + Space, always all three */
  onRowActivate?: (row: Row, index: number) => void
  /**
   * `double-click` is for grids where a plain click already means something
   * else (the data grid selects the row); `Enter` still activates.
   */
  activateOn?: 'click' | 'double-click'
  /** plain single click, when it is not activation */
  onRowClick?: (row: Row, index: number, event: React.MouseEvent) => void
  onRowContextMenu?: (row: Row, index: number) => MenuItem[]
  /** diff / status row wash */
  rowTone?: (row: Row) => Tone | null
  loading?: boolean
  /** trailing skeleton row + aria-busy while results are still arriving */
  streaming?: boolean
  empty?: React.ReactNode
  stickyHeader?: boolean
  className?: string
  tableClassName?: string
  rowClassName?: (row: Row, index: number) => string | undefined
  'aria-label'?: string
}

const TONE_WASH: Record<Tone, string> = {
  neutral: '',
  accent: 'bg-accent-quiet',
  success: 'bg-success-quiet',
  warning: 'bg-warning-quiet',
  danger: 'bg-danger-quiet',
  running: 'bg-running-quiet',
  idle: 'bg-idle-quiet'
}

/** Inline `left`/`right` beats the `left-0` utility, so sticky columns stack. */
function stickyStyle<Row>(column: Column<Row>, width?: number): React.CSSProperties | undefined {
  const style: React.CSSProperties = {}
  if (width != null) style.width = width
  if (column.stickyOffset != null && column.sticky === 'left') style.left = column.stickyOffset
  if (column.stickyOffset != null && column.sticky === 'right') style.right = column.stickyOffset
  return Object.keys(style).length > 0 ? style : undefined
}

/**
 * One column model over two variants. Every activatable row gets `role="row"`,
 * a tab stop, `onKeyDown` and `aria-selected` — mouse-only rows are a defect.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  variant = 'report',
  density = 'compact',
  sort,
  onSortChange,
  selection,
  onRowActivate,
  activateOn = 'click',
  onRowClick,
  onRowContextMenu,
  rowTone,
  loading,
  streaming,
  empty,
  stickyHeader = true,
  className,
  tableClassName,
  rowClassName,
  'aria-label': ariaLabel
}: DataTableProps<Row>) {
  const menu = useContextMenu<{ row: Row; index: number }>()
  // A checkbox `change` event carries no modifier state, so the preceding
  // `click` records it for range selection.
  const shiftPressed = React.useRef(false)
  const menuItems =
    menu.state && onRowContextMenu
      ? onRowContextMenu(menu.state.payload.row, menu.state.payload.index)
      : []

  const keys = React.useMemo(() => rows.map((row, index) => rowKey(row, index)), [rowKey, rows])
  const selectableKeys = React.useMemo(
    () =>
      selection
        ? keys.filter((_, index) => {
            const row = rows[index]
            return row !== undefined && !selection.isDisabled?.(row)
          })
        : [],
    [keys, rows, selection]
  )

  const allSelected =
    selection != null && selectableKeys.length > 0 && selectableKeys.every((key) => selection.selected.has(key))
  const someSelected =
    selection != null && !allSelected && selectableKeys.some((key) => selection.selected.has(key))

  const toggleAll = () => {
    if (!selection) return
    selection.onChange(allSelected ? new Set() : new Set(selectableKeys))
  }

  const toggleOne = (key: string) => {
    if (!selection) return
    const next = new Set(selection.mode === 'single' ? [] : selection.selected)
    if (selection.selected.has(key)) next.delete(key)
    else next.add(key)
    selection.onChange(next)
  }

  const onSort = (column: Column<Row>) => {
    if (!onSortChange) return
    if (sort?.columnId !== column.id) {
      onSortChange({ columnId: column.id, direction: 'asc' })
      return
    }
    onSortChange(sort.direction === 'asc' ? { columnId: column.id, direction: 'desc' } : null)
  }

  if (loading) {
    return (
      <div className={cn('p-2', className)} aria-busy>
        <Skeleton variant="row" count={12} />
      </div>
    )
  }

  if (rows.length === 0 && empty) {
    return <div className={className}>{empty}</div>
  }

  return (
    <div className={cn('min-h-0 overflow-auto', className)} aria-busy={streaming || undefined}>
      <Table
        variant={variant}
        density={density}
        aria-label={ariaLabel}
        className={tableClassName}
      >
        <THead className={stickyHeader ? undefined : 'static'}>
          <Tr className="hover:bg-transparent">
            {selection ? (
              <Th sticky="left" className="w-8">
                <Checkbox
                  size="sm"
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={toggleAll}
                  aria-label={selection.selectAllLabel}
                  disabled={selectableKeys.length === 0}
                />
              </Th>
            ) : null}
            {columns.map((column) => (
              <Th
                key={column.id}
                align={column.align}
                sticky={column.sticky}
                className={column.headerClassName}
                sortable={column.sortable && onSortChange != null}
                sortDirection={sort?.columnId === column.id ? sort.direction : null}
                onSort={() => onSort(column)}
                style={stickyStyle(column, column.width)}
              >
                {column.header}
              </Th>
            ))}
          </Tr>
        </THead>
        <TBody>
          {rows.map((row, index) => {
            const key = keys[index] ?? String(index)
            const selected = selection?.selected.has(key) ?? false
            const tone = rowTone?.(row) ?? null
            const activatable = onRowActivate != null
            const clickActivates = activatable && activateOn === 'click'
            const interactive = activatable || onRowClick != null
            return (
              <Tr
                key={key}
                selected={selected}
                tabIndex={interactive ? 0 : undefined}
                data-focus-inset={interactive ? '' : undefined}
                onClick={
                  clickActivates
                    ? () => onRowActivate?.(row, index)
                    : onRowClick
                      ? (event) => onRowClick(row, index, event)
                      : undefined
                }
                onDoubleClick={
                  activatable && activateOn === 'double-click'
                    ? () => onRowActivate?.(row, index)
                    : undefined
                }
                onKeyDown={
                  activatable
                    ? (event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        onRowActivate?.(row, index)
                      }
                    : undefined
                }
                onContextMenu={
                  onRowContextMenu ? (event) => menu.open(event, { row, index }) : undefined
                }
                className={cn(
                  tone && TONE_WASH[tone],
                  interactive && 'cursor-pointer',
                  rowClassName?.(row, index)
                )}
              >
                {selection ? (
                  <Td sticky="left" className="w-8">
                    <Checkbox
                      size="sm"
                      checked={selected}
                      disabled={selection.isDisabled?.(row)}
                      aria-label={selection.label?.(row, index)}
                      onClick={(event) => {
                        event.stopPropagation()
                        shiftPressed.current = event.shiftKey
                      }}
                      onChange={() => {
                        const shiftKey = shiftPressed.current
                        shiftPressed.current = false
                        if (selection.onToggle) selection.onToggle(row, index, shiftKey)
                        else toggleOne(key)
                      }}
                    />
                  </Td>
                ) : null}
                {columns.map((column) => (
                  <Td
                    key={column.id}
                    align={column.align}
                    mono={column.mono}
                    truncate={column.truncate}
                    sticky={column.sticky}
                    style={stickyStyle(column)}
                    className={column.cellClassName}
                    title={column.title?.(row)}
                  >
                    {column.cell(row, index)}
                  </Td>
                ))}
              </Tr>
            )
          })}
          {streaming ? (
            <tr>
              <td colSpan={columns.length + (selection ? 1 : 0)} className="p-1">
                <Skeleton variant="row" count={1} delayMs={0} />
              </td>
            </tr>
          ) : null}
        </TBody>
      </Table>
      {onRowContextMenu ? (
        <ContextMenu items={menuItems} at={menu.state} onClose={menu.close} width="w-64" />
      ) : null}
    </div>
  )
}
