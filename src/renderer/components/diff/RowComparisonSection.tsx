// Content diff tab 中按表展示行级对比详情的区域，包含 “Show all/Only different” 切换。
//
// Blueprint §3.5: `SearchInput` replaces the input + clear-button pair, the
// show-all/only-different toggle is a `ToggleGroup` (it is a view mode, not an
// action), every row carries a `DiffGutter` sign, and the two `text-amber-400`
// literals became `--ds-warning` ink.
import type { RefObject } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { DiffGutter, type DiffKind } from '@renderer/components/ui/diff-gutter'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { Panel } from '@renderer/components/ui/panel'
import { SearchInput } from '@renderer/components/ui/search-input'
import { ToggleGroup } from '@renderer/components/ui/toggle-group'
import type { TableDataDiff, TableRowComparison } from '../../../shared/types'
import { useI18n } from '@renderer/i18n'
import { filterChangedRowComparisons, matchesTableSearchQuery } from './diff-panel-utils'
import { formatDataSummary } from './diff-panel-formatters'
import { TableOpenActions } from './diff-panel-presentation'

interface RowComparisonSectionProps {
  rowComparisons: TableRowComparison[]
  showAll: boolean
  tableSearchQuery: string
  onSearchChange: (value: string) => void
  onClearSearch: () => void
  onToggleShowAll: () => void
  onOpenCompare: (table: string) => void
  onOpenSource: (table: string) => void
  onOpenTarget: (table: string) => void
  searchInputRef?: RefObject<HTMLInputElement | null>
}

function rowDiffKind(dataDiff: TableDataDiff): DiffKind {
  if (!dataDiff.comparable) return 'same'
  if (dataDiff.sourceOnly === 0 && dataDiff.targetOnly === 0 && dataDiff.modified === 0) {
    return 'same'
  }
  return 'mod'
}

export function RowComparisonSection({
  rowComparisons,
  showAll,
  tableSearchQuery,
  onSearchChange,
  onClearSearch,
  onToggleShowAll,
  onOpenCompare,
  onOpenSource,
  onOpenTarget,
  searchInputRef
}: RowComparisonSectionProps) {
  const { t } = useI18n()
  const changedRowComparisons = filterChangedRowComparisons(rowComparisons)
  const baseRowComparisons = showAll ? rowComparisons : changedRowComparisons
  const visibleRowComparisons = baseRowComparisons.filter((rowComparison) =>
    matchesTableSearchQuery(rowComparison.table, tableSearchQuery)
  )
  const hiddenTableCount = rowComparisons.length - changedRowComparisons.length
  const hasActiveSearch = tableSearchQuery.trim().length > 0

  return (
    <Panel
      padded={false}
      header={
        <span className="flex items-center gap-2">
          {t('diff.rowCompare.title')}
          <Badge>{t('diff.rowCompare.tableCount', { count: rowComparisons.length })}</Badge>
        </span>
      }
      headerActions={
        <>
          <SearchInput
            ref={searchInputRef}
            size="sm"
            value={tableSearchQuery}
            onValueChange={(value) => (value ? onSearchChange(value) : onClearSearch())}
            placeholder={t('diff.result.searchTable')}
            clearLabel={t('common.clear')}
            containerClassName="w-44"
          />
          {hiddenTableCount > 0 ? (
            <ToggleGroup<'changed' | 'all'>
              size="xs"
              aria-label={t('diff.rowCompare.title')}
              value={showAll ? 'all' : 'changed'}
              onValueChange={(value) => {
                if ((value === 'all') !== showAll) onToggleShowAll()
              }}
              options={[
                { value: 'changed', label: t('diff.rowCompare.onlyDifferent') },
                { value: 'all', label: t('diff.rowCompare.showAll') }
              ]}
            />
          ) : null}
        </>
      }
    >
      {visibleRowComparisons.length === 0 ? (
        <EmptyState
          size="sm"
          variant="no-results"
          title={hasActiveSearch ? t('diff.result.noTablesMatch') : t('diff.rowCompare.noDiffs')}
          description={
            hasActiveSearch ? t('diff.result.adjustFilters') : t('diff.rowCompare.noDiffsHint')
          }
          action={
            hasActiveSearch ? (
              <Button size="sm" variant="secondary" onClick={onClearSearch}>
                {t('common.clear')}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" disabled={showAll} onClick={onToggleShowAll}>
                {t('diff.rowCompare.showAll')}
              </Button>
            )
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {visibleRowComparisons.map((rowComparison) => (
            <li key={rowComparison.table} className="px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <DiffGutter kind={rowDiffKind(rowComparison.dataDiff)} />
                <strong className="min-w-0 truncate font-mono text-sm">
                  {rowComparison.table}
                </strong>
                <RowCompareBadge dataDiff={rowComparison.dataDiff} />
                <span className="mr-auto text-2xs text-fg-muted">
                  {formatDataSummary(rowComparison.dataDiff, t)}
                </span>
                <TableOpenActions
                  compareAvailable
                  sourceAvailable
                  targetAvailable
                  onOpenCompare={() => onOpenCompare(rowComparison.table)}
                  onOpenSource={() => onOpenSource(rowComparison.table)}
                  onOpenTarget={() => onOpenTarget(rowComparison.table)}
                />
              </div>
              <DataDiffSection dataDiff={rowComparison.dataDiff} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function RowCompareBadge({ dataDiff }: { dataDiff: TableDataDiff }) {
  const { t } = useI18n()
  if (!dataDiff.comparable) {
    return (
      <Badge tone="warning" icon={TriangleAlert}>
        {t('diff.rowCompare.skipped')}
      </Badge>
    )
  }
  if (dataDiff.sourceOnly === 0 && dataDiff.targetOnly === 0 && dataDiff.modified === 0) {
    return <Badge tone="success">{t('diff.rowCompare.identical')}</Badge>
  }
  return <Badge tone="danger">{t('diff.rowCompare.different')}</Badge>
}

function DataDiffSection({ dataDiff }: { dataDiff: TableDataDiff }) {
  const { t } = useI18n()
  return (
    <div className="mt-2 space-y-1 rounded-md bg-inset px-2 py-1.5 text-xs">
      {!dataDiff.comparable ? (
        <div className="text-warning-text">
          {dataDiff.reason || t('diff.rowCompare.rowComparisonSkipped')}
        </div>
      ) : (
        <>
          <div>{t('diff.rowCompare.comparedBy', { columns: dataDiff.keyColumns.join(', ') })}</div>
          {dataDiff.reason ? <div className="text-warning-text">{dataDiff.reason}</div> : null}
          <div className="text-fg-muted">
            {t('diff.rowCompare.countSummary', {
              sourceRows: dataDiff.sourceRowCount,
              targetRows: dataDiff.targetRowCount,
              sourceOnly: dataDiff.sourceOnly,
              targetOnly: dataDiff.targetOnly,
              modified: dataDiff.modified
            })}
          </div>
        </>
      )}
    </div>
  )
}
