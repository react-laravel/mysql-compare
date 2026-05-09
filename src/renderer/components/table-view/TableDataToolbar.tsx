import {
  Columns3,
  Copy,
  Download,
  Filter,
  ListRestart,
  Plus,
  RefreshCw,
  Trash2,
  WrapText,
  X
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Badge } from '@renderer/components/ui/badge'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'

interface TableDataToolbarProps {
  where: string
  hasPendingWhere: boolean
  hasActiveFilter: boolean
  loading: boolean
  selectedCount: number
  wrapCells: boolean
  density: 'compact' | 'comfortable'
  readOnly?: boolean
  filterEnabled?: boolean
  columnCounts?: {
    visible: number
    total: number
  }
  onWhereChange: (value: string) => void
  onApplyWhere: () => void
  onClearWhere: () => void
  onRefresh: () => void
  onOpenExport: () => void
  onOpenColumnPanel: () => void
  onToggleWrapCells: () => void
  onToggleDensity: () => void
  onInsert: () => void
  onDeleteSelected: () => void
  onCopySelectedRows: () => void
  onClearSelection: () => void
}

export function TableDataToolbar({
  where,
  hasPendingWhere,
  hasActiveFilter,
  loading,
  selectedCount,
  wrapCells,
  density,
  readOnly = false,
  filterEnabled = true,
  columnCounts,
  onWhereChange,
  onApplyWhere,
  onClearWhere,
  onRefresh,
  onOpenExport,
  onOpenColumnPanel,
  onToggleWrapCells,
  onToggleDensity,
  onInsert,
  onDeleteSelected,
  onCopySelectedRows,
  onClearSelection
}: TableDataToolbarProps) {
  const { t } = useI18n()

  return (
    <div className="border-b border-border bg-card/70 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {filterEnabled && (
          <div className="relative min-w-[18rem] flex-[1_1_24rem]">
            <Filter className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={where}
              onChange={(event) => onWhereChange(event.target.value)}
              placeholder={t('tableData.whereClausePlaceholder')}
              className="h-8 pl-8 pr-8 font-mono text-xs"
              onKeyDown={(event) => {
                if (event.key === 'Enter') onApplyWhere()
                if (event.key === 'Escape') onClearWhere()
              }}
            />
            {hasActiveFilter && (
              <button
                type="button"
                className="absolute right-2 top-1/2 rounded p-0.5 text-muted-foreground -translate-y-1/2 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={onClearWhere}
                title={t('tableData.clearFilter')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-1">
          {filterEnabled && (
            <Button size="sm" variant="outline" onClick={onApplyWhere} disabled={!hasPendingWhere}>
              {t('common.apply')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading} title={t('common.refresh')}>
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </Button>
          {!readOnly && (
            <Button size="sm" variant="outline" onClick={onOpenExport}>
              <Download className="w-4 h-4" /> {t('common.export')}
            </Button>
          )}
          {columnCounts && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onOpenColumnPanel}
                title={t('tableData.columnsPanel')}
              >
                <Columns3 className="h-4 w-4" />
                {t('tableData.columnsCount', {
                  visible: columnCounts.visible,
                  total: columnCounts.total
                })}
              </Button>
              <Button
                size="sm"
                variant={wrapCells ? 'secondary' : 'ghost'}
                onClick={onToggleWrapCells}
                title={t('tableData.toggleWrap')}
              >
                <WrapText className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant={density === 'comfortable' ? 'secondary' : 'ghost'}
                onClick={onToggleDensity}
                title={t('tableData.toggleDensity')}
              >
                <ListRestart className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>

        {!readOnly && (
          <>
            <div className="mx-1 h-6 w-px bg-border" />

            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={onInsert}>
                <Plus className="w-4 h-4" /> {t('common.insert')}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={onDeleteSelected}
                disabled={selectedCount === 0}
              >
                <Trash2 className="w-4 h-4" /> {t('tableData.deleteCount', { count: selectedCount })}
              </Button>
              {selectedCount > 0 && (
                <>
                  <Button size="sm" variant="ghost" onClick={onCopySelectedRows}>
                    <Copy className="h-4 w-4" /> {t('tableData.copySelected')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onClearSelection}>
                    <X className="h-4 w-4" /> {t('tableData.clearSelection')}
                  </Button>
                  <Badge className="ml-1">{t('tableData.selectedRows', { count: selectedCount })}</Badge>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}