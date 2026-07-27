// The Data toolbar (blueprint §3.1).
//
// It used to be an 11-control strip that wrapped onto two or three lines at
// narrow widths and pushed the grid down. It is now the shared `Toolbar`:
// four high-frequency actions, one `⋯`, one filters row, and a 2px progress
// line on the bottom edge that costs zero layout. The amber no-primary-key
// band (`TableDataView.tsx:186-191`, −26px of permanent chrome) became a
// `Badge` in the subtitle.
import type { ReactNode, RefObject } from 'react'
import {
  Columns3,
  Copy,
  Download,
  Eraser,
  Filter,
  Plus,
  RefreshCw,
  Rows3,
  Table as TableIcon,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import type { MenuItem } from '@renderer/components/ui/dropdown-menu'
import { IconButton } from '@renderer/components/ui/icon-button'
import { SearchInput } from '@renderer/components/ui/search-input'
import { Toolbar } from '@renderer/components/ui/toolbar'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { PAGE_SIZE_OPTIONS } from '@renderer/store/settings-store'
import { formatNumber } from '@renderer/lib/format'
import { useI18n } from '@renderer/i18n'

export interface TableDataToolbarProps {
  table: string
  database: string
  connectionName?: string
  engine?: string
  /** the Data / Structure / Info pill `Tabs`, rendered inside the toolbar */
  tabs?: ReactNode
  where: string
  hasPendingWhere: boolean
  hasActiveFilter: boolean
  loading: boolean
  selectedCount: number
  totalRows?: number
  hasPrimaryKey: boolean
  wrapCells: boolean
  density: 'compact' | 'comfortable'
  pageSize: number
  readOnly?: boolean
  filterEnabled?: boolean
  exportEnabled?: boolean
  columnCounts?: {
    visible: number
    total: number
  }
  /** the table object's own verbs — the same builder the tree row uses */
  objectItems?: MenuItem[]
  filterInputRef?: RefObject<HTMLInputElement | null>
  onWhereChange: (value: string) => void
  onApplyWhere: () => void
  onClearWhere: () => void
  onRefresh: () => void
  onOpenExport: () => void
  onOpenColumnPanel: () => void
  onToggleWrapCells: () => void
  onSetDensity: (density: 'compact' | 'comfortable') => void
  onPageSizeChange: (pageSize: number) => void
  onInsert: () => void
  onDeleteSelected: () => void
  onCopySelectedRows: () => void
  onCopySelectedAsInsert?: () => void
  onClearSelection: () => void
}

export function TableDataToolbar({
  table,
  database,
  connectionName,
  engine,
  tabs,
  where,
  hasPendingWhere,
  hasActiveFilter,
  loading,
  selectedCount,
  totalRows,
  hasPrimaryKey,
  wrapCells,
  density,
  pageSize,
  readOnly = false,
  filterEnabled = true,
  exportEnabled = true,
  columnCounts,
  objectItems,
  filterInputRef,
  onWhereChange,
  onApplyWhere,
  onClearWhere,
  onRefresh,
  onOpenExport,
  onOpenColumnPanel,
  onToggleWrapCells,
  onSetDensity,
  onPageSizeChange,
  onInsert,
  onDeleteSelected,
  onCopySelectedRows,
  onCopySelectedAsInsert,
  onClearSelection
}: TableDataToolbarProps) {
  const { t } = useI18n()

  const overflow: MenuItem[] = []

  if (!readOnly && exportEnabled) {
    overflow.push({
      id: 'export',
      icon: Download,
      label: t('sidebar.overlays.exportEllipsis'),
      onSelect: onOpenExport
    })
  }
  if (columnCounts) {
    overflow.push(
      {
        id: 'columns',
        icon: Columns3,
        label: t('tableData.columnsCount', {
          visible: columnCounts.visible,
          total: columnCounts.total
        }),
        onSelect: onOpenColumnPanel
      },
      {
        kind: 'checkbox',
        id: 'wrap',
        label: t('tableData.toggleWrap'),
        checked: wrapCells,
        onSelect: onToggleWrapCells
      },
      {
        kind: 'submenu',
        id: 'density',
        icon: Rows3,
        label: t('tableData.toggleDensity'),
        items: [
          {
            kind: 'checkbox',
            id: 'density-compact',
            label: t('settings.appearance.densityCompact'),
            checked: density === 'compact',
            onSelect: () => onSetDensity('compact')
          },
          {
            kind: 'checkbox',
            id: 'density-comfortable',
            label: t('settings.appearance.densityComfortable'),
            checked: density === 'comfortable',
            onSelect: () => onSetDensity('comfortable')
          }
        ]
      }
    )
  }
  overflow.push({
    kind: 'submenu',
    id: 'page-size',
    icon: TableIcon,
    label: t('settings.grid.pageSize'),
    items: PAGE_SIZE_OPTIONS.map((size) => ({
      kind: 'checkbox' as const,
      id: `page-size-${size}`,
      label: String(size),
      checked: size === pageSize,
      onSelect: () => onPageSizeChange(size)
    }))
  })

  if (!readOnly) {
    overflow.push(
      { kind: 'separator', id: 'sep-selection' },
      {
        id: 'copy-selected-json',
        icon: Copy,
        label: t('tableData.copySelected'),
        disabled: selectedCount === 0,
        disabledReason: t('tableData.noSelection'),
        onSelect: onCopySelectedRows
      }
    )
    if (onCopySelectedAsInsert) {
      overflow.push({
        id: 'copy-selected-insert',
        icon: Copy,
        label: t('tableData.copySelectedAsInsert'),
        disabled: selectedCount === 0,
        disabledReason: t('tableData.noSelection'),
        onSelect: onCopySelectedAsInsert
      })
    }
    overflow.push({
      id: 'clear-selection',
      icon: X,
      label: t('tableData.clearSelection'),
      disabled: selectedCount === 0,
      disabledReason: t('tableData.noSelection'),
      onSelect: onClearSelection
    })
  }

  if (objectItems?.length) {
    overflow.push({ kind: 'separator', id: 'sep-object' }, ...objectItems)
  }

  const subtitle = `${[connectionName, database].filter(Boolean).join(' / ')}${engine ? ` · ${engine}` : ''}`

  // The keyless-table warning goes in `subtitleSlot`, not `subtitle`: it is the
  // reason half this toolbar is disabled, and `subtitle` truncates.
  const subtitleSlot =
    !readOnly && !hasPrimaryKey ? (
      <Tooltip content={t('tableData.noPrimaryKeyHint')}>
        <span className="inline-flex">
          <Badge tone="warning" icon={TriangleAlert}>
            {t('tableData.noPk')}
          </Badge>
        </span>
      </Tooltip>
    ) : null

  return (
    <Toolbar
      title={<span className="font-mono">{table}</span>}
      subtitle={subtitle}
      subtitleSlot={subtitleSlot}
      center={tabs}
      overflowLabel={t('common.moreActions')}
      overflow={overflow}
      progress={loading ? { status: 'running', label: t('common.loading') } : null}
      actions={
        <>
          <IconButton
            icon={RefreshCw}
            label={t('common.refresh')}
            shortcut="Mod+R"
            size="sm"
            variant="ghost"
            loading={loading}
            disabled={loading}
            onClick={onRefresh}
          />
          {!readOnly && (
            <>
              <Button size="sm" variant="primary" icon={Plus} onClick={onInsert}>
                {t('common.insert')}
              </Button>
              <Button
                size="sm"
                variant="danger-ghost"
                icon={Trash2}
                onClick={onDeleteSelected}
                disabled={selectedCount === 0}
              >
                {t('tableData.deleteCount', { count: selectedCount })}
              </Button>
            </>
          )}
        </>
      }
      filters={
        <>
          {filterEnabled && (
            <>
              <SearchInput
                ref={filterInputRef}
                size="sm"
                mono
                leadingIcon={Filter}
                value={where}
                onValueChange={onWhereChange}
                clearable={hasActiveFilter}
                clearLabel={t('tableData.clearFilter')}
                onClear={onClearWhere}
                placeholder={t('tableData.whereClausePlaceholder')}
                containerClassName="min-w-[16rem] flex-[1_1_22rem]"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onApplyWhere()
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    onClearWhere()
                  }
                }}
              />
              <Button size="sm" variant="secondary" onClick={onApplyWhere} disabled={!hasPendingWhere}>
                {t('common.apply')}
              </Button>
            </>
          )}
          <span className="ml-auto flex items-center gap-1.5" aria-live="polite">
            {totalRows != null ? (
              <Badge>{t('tableData.rowCount', { count: formatNumber(totalRows) })}</Badge>
            ) : null}
            {selectedCount > 0 ? (
              <Badge tone="accent">{t('tableData.selectedRows', { count: selectedCount })}</Badge>
            ) : null}
            {hasActiveFilter ? (
              <Button size="xs" variant="ghost" icon={Eraser} onClick={onClearWhere}>
                {t('tableData.clearFilter')}
              </Button>
            ) : null}
          </span>
        </>
      }
    />
  )
}
