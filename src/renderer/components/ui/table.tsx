import * as React from 'react'
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export type TableVariant = 'report' | 'grid'
export type TableDensity = 'compact' | 'comfortable'
export type SortDirection = 'asc' | 'desc'

interface TableContextValue {
  variant: TableVariant
  density: TableDensity
}

const TableContext = React.createContext<TableContextValue>({
  variant: 'report',
  density: 'compact'
})

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /** `report` = read-mostly 28px rows · `grid` = data grid, 26/30px rows */
  variant?: TableVariant
  density?: TableDensity
}

export function Table({ className, variant = 'report', density = 'compact', ...p }: TableProps) {
  const ctx = React.useMemo<TableContextValue>(() => ({ variant, density }), [variant, density])
  return (
    <TableContext.Provider value={ctx}>
      <table
        data-variant={variant}
        data-density={density}
        className={cn('w-full caption-bottom border-collapse text-sm', className)}
        {...p}
      />
    </TableContext.Provider>
  )
}

export const THead = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead
    className={cn('sticky top-0 z-[var(--ds-z-sticky)] bg-surface-2', className)}
    {...p}
  />
)

export const TBody = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody className={cn(className)} {...p} />
)

export interface TrProps extends React.HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean
}

export function Tr({ className, selected, ...p }: TrProps) {
  const { variant, density } = React.useContext(TableContext)
  const height =
    variant === 'grid'
      ? density === 'comfortable'
        ? 'h-row-grid-comfy'
        : 'h-row-grid'
      : 'h-row-table'
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        height,
        'border-b border-border hover:bg-hover',
        selected && 'bg-selected',
        className
      )}
      {...p}
    />
  )
}

export interface ThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right'
  sortable?: boolean
  /** current direction when this column owns the sort; `null`/undefined = unsorted */
  sortDirection?: SortDirection | null
  onSort?: () => void
  sticky?: 'left' | 'right'
}

export function Th({
  className,
  align = 'left',
  sortable,
  sortDirection,
  onSort,
  sticky,
  children,
  ...p
}: ThProps) {
  const { variant } = React.useContext(TableContext)
  const base = cn(
    variant === 'grid' ? 'h-row-grid px-2' : 'h-row-table px-3',
    'align-middle font-medium text-fg-muted border-b border-border whitespace-nowrap',
    align === 'right' ? 'text-right' : 'text-left',
    sticky === 'left' && 'sticky left-0 z-[var(--ds-z-sticky)] bg-surface-2',
    sticky === 'right' && 'sticky right-0 z-[var(--ds-z-sticky)] bg-surface-2',
    className
  )

  if (!sortable) {
    return (
      <th className={base} {...p}>
        {children}
      </th>
    )
  }

  const ariaSort = sortDirection === 'asc' ? 'ascending' : sortDirection === 'desc' ? 'descending' : 'none'
  const Glyph = sortDirection === 'asc' ? ChevronUp : sortDirection === 'desc' ? ChevronDown : ChevronsUpDown
  return (
    <th className={base} aria-sort={ariaSort} {...p}>
      <button
        type="button"
        onClick={onSort}
        data-focus-inset
        className={cn(
          'inline-flex w-full items-center gap-1 hover:text-fg',
          align === 'right' && 'justify-end'
        )}
      >
        {children}
        <Glyph
          aria-hidden
          strokeWidth={1.75}
          className={cn('size-3 shrink-0', sortDirection ? 'text-accent-text' : 'text-fg-subtle')}
        />
      </button>
    </th>
  )
}

export interface TdProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right'
  mono?: boolean
  /** opt-in; the base cell no longer clamps to max-w-xs */
  truncate?: boolean
  sticky?: 'left' | 'right'
}

export function Td({ className, align, mono, truncate, sticky, ...p }: TdProps) {
  const { variant } = React.useContext(TableContext)
  return (
    <td
      className={cn(
        variant === 'grid' ? 'px-2' : 'px-3',
        'align-middle whitespace-nowrap',
        align === 'right' && 'text-right',
        mono && 'font-mono',
        truncate && 'max-w-xs truncate',
        sticky === 'left' && 'sticky left-0 z-[var(--ds-z-sticky)] bg-surface',
        sticky === 'right' && 'sticky right-0 z-[var(--ds-z-sticky)] bg-surface',
        className
      )}
      {...p}
    />
  )
}
