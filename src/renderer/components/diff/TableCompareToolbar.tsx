// The table compare's view toolbar (blueprint §3.6).
//
// Before: a 4-button strip plus a swatch legend plus an amber no-primary-key
// band, all stacked above the panes. Now one `Toolbar`:
//   · title/subtitle name the comparison (`Compare · orders`, `prod/shop ↔ …`);
//   · one primary action — "Copy N to target";
//   · everything else (overwrite, both deletes, reload, diff navigation, page
//     size) is in the single `⋯`, and every one of them is wired;
//   · the filters row carries the glyph legend, the diff position and the
//     no-primary-key warning that used to be its own 40px band.
import { ArrowRight, ArrowRightLeft, ChevronLeft, ChevronRight, RefreshCw, Table as TableIcon, Trash2, TriangleAlert } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import type { MenuItem } from '@renderer/components/ui/dropdown-menu'
import type { ProgressState } from '@renderer/components/ui/progress-bar'
import { Toolbar } from '@renderer/components/ui/toolbar'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { PAGE_SIZE_OPTIONS } from '@renderer/store/settings-store'
import { useI18n } from '@renderer/i18n'
import { TableCompareLegend } from './table-compare-presentation'

export interface TableCompareToolbarProps {
  table: string
  sourceLabel: string
  targetLabel: string
  progress: ProgressState | null
  /** rows selected on the source pane — the copy direction is source → target */
  sourceSelectedCount: number
  targetSelectedCount: number
  copyEnabled: boolean
  copying: boolean
  actionBusy: boolean
  sourceHasPrimaryKey: boolean
  pageSize: number
  diffNavigation: {
    previousTable: string | null
    nextTable: string | null
    currentDiffPosition: number | null
    totalDiffTables: number
  }
  onCopySelected: () => void
  onOverwriteTarget: () => void
  onDeleteSelected: (side: 'source' | 'target') => void
  onReloadBoth: () => void
  onNavigateToTable: (table: string) => void
  onPageSizeChange: (pageSize: number) => void
}

export function TableCompareToolbar({
  table,
  sourceLabel,
  targetLabel,
  progress,
  sourceSelectedCount,
  targetSelectedCount,
  copyEnabled,
  copying,
  actionBusy,
  sourceHasPrimaryKey,
  pageSize,
  diffNavigation,
  onCopySelected,
  onOverwriteTarget,
  onDeleteSelected,
  onReloadBoth,
  onNavigateToTable,
  onPageSizeChange
}: TableCompareToolbarProps) {
  const { t } = useI18n()

  const overflow: MenuItem[] = [
    {
      id: 'reload',
      icon: RefreshCw,
      label: t('diff.compareView.reloadBoth'),
      shortcut: 'Mod+R',
      onSelect: onReloadBoth
    },
    {
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
    },
    { kind: 'separator', id: 'sep-navigate' },
    {
      id: 'previous-diff',
      icon: ChevronLeft,
      label: t('diff.compareView.prevDiffTable'),
      disabled: !diffNavigation.previousTable,
      disabledReason: t('diff.compareView.noMoreDiffTables'),
      onSelect: () => {
        if (diffNavigation.previousTable) onNavigateToTable(diffNavigation.previousTable)
      }
    },
    {
      id: 'next-diff',
      icon: ChevronRight,
      label: t('diff.compareView.nextDiffTable'),
      disabled: !diffNavigation.nextTable,
      disabledReason: t('diff.compareView.noMoreDiffTables'),
      onSelect: () => {
        if (diffNavigation.nextTable) onNavigateToTable(diffNavigation.nextTable)
      }
    },
    { kind: 'separator', id: 'sep-danger' },
    {
      id: 'delete-source',
      icon: Trash2,
      danger: true,
      label: t('diff.compareView.deleteSelectedOnSource', { count: sourceSelectedCount }),
      disabled: actionBusy || sourceSelectedCount === 0,
      disabledReason: t('tableData.noSelection'),
      onSelect: () => onDeleteSelected('source')
    },
    {
      id: 'delete-target',
      icon: Trash2,
      danger: true,
      label: t('diff.compareView.deleteSelectedOnTarget', { count: targetSelectedCount }),
      disabled: actionBusy || targetSelectedCount === 0,
      disabledReason: t('tableData.noSelection'),
      onSelect: () => onDeleteSelected('target')
    },
    {
      id: 'overwrite-target',
      icon: ArrowRightLeft,
      danger: true,
      label: t('diff.compareView.overwriteTargetTable'),
      disabled: actionBusy,
      disabledReason: t('diff.compareView.actionRunning'),
      onSelect: onOverwriteTarget
    }
  ]

  return (
    <Toolbar
      icon={ArrowRightLeft}
      title={t('diff.compareView.title', { table })}
      subtitle={`${sourceLabel} ↔ ${targetLabel}`}
      progress={progress}
      overflowLabel={t('common.moreActions')}
      overflow={overflow}
      actions={
        <Button
          size="sm"
          variant="primary"
          icon={ArrowRight}
          loading={copying}
          disabled={!copyEnabled}
          onClick={onCopySelected}
        >
          {t('diff.compareView.copyCountToTarget', { count: sourceSelectedCount })}
        </Button>
      }
      filters={
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" aria-live="polite">
          <TableCompareLegend />
          {diffNavigation.totalDiffTables > 0 ? (
            <Badge>
              {diffNavigation.currentDiffPosition === null
                ? t('diff.compareView.diffsChanged', { count: diffNavigation.totalDiffTables })
                : t('diff.compareView.diffPos', {
                    pos: diffNavigation.currentDiffPosition,
                    total: diffNavigation.totalDiffTables
                  })}
            </Badge>
          ) : null}
          {!sourceHasPrimaryKey ? (
            // The amber band this replaces was ~40px of permanent chrome; the
            // full explanation lives in the tooltip.
            <Tooltip content={t('diff.compareView.noPkCopyDisabled')}>
              <span className="inline-flex">
                <Badge tone="warning" icon={TriangleAlert}>
                  {t('diff.compareView.noPkBadge')}
                </Badge>
              </span>
            </Tooltip>
          ) : null}
        </div>
      }
    />
  )
}
