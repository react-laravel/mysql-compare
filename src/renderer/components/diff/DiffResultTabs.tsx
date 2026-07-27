// 对比结果卡片中三个 Tab 的内容子组件：Tables / Status / Schema。
// 拆出来主要是把 DiffPanel.tsx 的 JSX 体积压下去，逻辑全部由父组件传入。
//
// Blueprint §3.5: the status filter `<select>` became a `ToggleGroup
// variant="chips"` with live counts under `aria-live="polite"`, the two
// hand-rolled input+clear pairs became `SearchInput`, and every schema line
// carries a `DiffGutter` sign (DESIGN-SYSTEM §1.5 — the colours alone measure
// ΔE 5.6 under deuteranopia in dark mode).
import { useMemo, type RefObject } from 'react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Panel } from '@renderer/components/ui/panel'
import { SearchInput } from '@renderer/components/ui/search-input'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { ToggleGroup, type ToggleOption } from '@renderer/components/ui/toggle-group'
import { useI18n } from '@renderer/i18n'
import type { TableDiff } from '../../../shared/types'
import {
  formatColumnLine,
  formatComparePhase,
  formatDataSummary,
  formatIndexLine,
  type ComparePhase
} from './diff-panel-formatters'
import {
  ComparePhaseIcon,
  DiffColumn,
  EmptyResultState,
  KindBadge,
  schemaLineDiffKind,
  TableOpenActions
} from './diff-panel-presentation'
import { TableListPanel } from './TableListPanel'
import { ComparisonStatusPanel } from './ComparisonStatusPanel'
import {
  filterComparisonEntries,
  matchesTableSearchQuery,
  type TableCompareEntry,
  type TableStatusFilter
} from './diff-panel-utils'

interface TablesTabContentProps {
  sourceTables: string[]
  targetTables: string[]
  sharedTableCount: number
  phase: ComparePhase
}

export function TablesTabContent({ sourceTables, targetTables, phase }: TablesTabContentProps) {
  const { t } = useI18n()
  const sourceTableSet = new Set(sourceTables)
  const targetTableSet = new Set(targetTables)

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
      <TableListPanel
        title={t('diff.result.sourcePanelTitle')}
        tables={sourceTables}
        phase={phase}
        getPresence={(table) => (targetTableSet.has(table) ? 'shared' : 'source-only')}
      />
      <TableListPanel
        title={t('diff.result.targetPanelTitle')}
        tables={targetTables}
        phase={phase}
        getPresence={(table) => (sourceTableSet.has(table) ? 'shared' : 'target-only')}
      />
    </div>
  )
}

/** The five filters the app already had, now as chips with live counts. */
const STATUS_FILTERS: TableStatusFilter[] = [
  'all',
  'changed',
  'schema-changed',
  'row-changed',
  'comparing'
]

const STATUS_FILTER_LABEL_KEY = {
  all: 'diff.result.statusAll',
  changed: 'diff.result.statusOnlyChanged',
  'schema-changed': 'diff.result.statusStructureChanged',
  'row-changed': 'diff.result.statusContentChanged',
  comparing: 'diff.result.statusComparing'
} as const

interface StatusTabContentProps {
  comparisonEntries: TableCompareEntry[]
  prioritizedComparisonEntries: TableCompareEntry[]
  filteredComparisonEntries: TableCompareEntry[]
  sharedTableCount: number
  completedSharedTableCount: number
  pendingSharedTable?: string
  hasCompareErrors: boolean
  comparePhase: ComparePhase
  statusFilter: TableStatusFilter
  tableSearchQuery: string
  selectedComparisonTable: string | null
  onSelectTable: (table: string | null) => void
  onSearchChange: (value: string) => void
  onClearSearch: () => void
  onStatusFilterChange: (value: TableStatusFilter) => void
  onOpenCompare: (table: string) => void
  onOpenSource: (table: string) => void
  onOpenTarget: (table: string) => void
  onRetryTable: (table: string) => void
  searchInputRef?: RefObject<HTMLInputElement | null>
}

export function StatusTabContent({
  comparisonEntries,
  prioritizedComparisonEntries,
  filteredComparisonEntries,
  sharedTableCount,
  completedSharedTableCount,
  pendingSharedTable,
  hasCompareErrors,
  comparePhase,
  statusFilter,
  tableSearchQuery,
  selectedComparisonTable,
  onSelectTable,
  onSearchChange,
  onClearSearch,
  onStatusFilterChange,
  onOpenCompare,
  onOpenSource,
  onOpenTarget,
  onRetryTable,
  searchInputRef
}: StatusTabContentProps) {
  const { t } = useI18n()
  const streaming = comparePhase === 'comparing' || comparePhase === 'loading-tables'

  const filterOptions = useMemo<ToggleOption<TableStatusFilter>[]>(
    () =>
      STATUS_FILTERS.map((filter) => ({
        value: filter,
        label: t(STATUS_FILTER_LABEL_KEY[filter]),
        count: filterComparisonEntries(comparisonEntries, filter, tableSearchQuery).length
      })),
    [comparisonEntries, t, tableSearchQuery]
  )

  return (
    <div className="flex min-w-0 flex-col gap-3" aria-busy={streaming || undefined}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SearchInput
          ref={searchInputRef}
          size="sm"
          value={tableSearchQuery}
          onValueChange={(value) => (value ? onSearchChange(value) : onClearSearch())}
          placeholder={t('diff.result.searchTable')}
          clearLabel={t('common.clear')}
          containerClassName="min-w-[12rem] flex-[1_1_16rem]"
        />
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
          <ComparePhaseIcon phase={comparePhase} />
          <span aria-live="polite">
            {formatComparePhase(
              comparePhase,
              completedSharedTableCount,
              sharedTableCount,
              pendingSharedTable,
              t
            )}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <Badge>{t('diff.result.shared', { count: sharedTableCount })}</Badge>
          {hasCompareErrors ? <Badge tone="danger">{t('diff.result.errorsPresent')}</Badge> : null}
        </span>
      </div>

      <div aria-live="polite">
        <ToggleGroup<TableStatusFilter>
          variant="chips"
          size="xs"
          aria-label={t('common.status')}
          value={statusFilter}
          onValueChange={onStatusFilterChange}
          options={filterOptions}
        />
      </div>

      {comparisonEntries.length > 0 ? (
        <ComparisonStatusPanel
          entries={prioritizedComparisonEntries}
          comparePhase={comparePhase}
          selectedTable={selectedComparisonTable}
          onSelectTable={onSelectTable}
          onOpenCompare={onOpenCompare}
          onOpenSource={onOpenSource}
          onOpenTarget={onOpenTarget}
          onRetryTable={onRetryTable}
        />
      ) : streaming ? (
        <Skeleton variant="row" count={6} />
      ) : (
        <EmptyResultState
          title={t('diff.result.noTablesMatch')}
          description={t('diff.result.adjustFilters')}
          action={
            <Button size="sm" variant="secondary" onClick={() => onStatusFilterChange('all')}>
              {t('diff.result.clearFilters')}
            </Button>
          }
        />
      )}

      {/* DS §7.4: mark the streaming boundary instead of hiding what arrived. */}
      {streaming && filteredComparisonEntries.length > 0 ? (
        <Skeleton variant="row" count={2} />
      ) : null}
    </div>
  )
}

interface SchemaTabContentProps {
  schemaDiffs: TableDiff[]
  hasRowComparisonResults: boolean
  tableSearchQuery: string
  onSearchChange: (value: string) => void
  onClearSearch: () => void
  onOpenCompare: (table: string) => void
  onOpenSource: (table: string) => void
  onOpenTarget: (table: string) => void
  searchInputRef?: RefObject<HTMLInputElement | null>
}

export function SchemaTabContent({
  schemaDiffs,
  hasRowComparisonResults,
  tableSearchQuery,
  onSearchChange,
  onClearSearch,
  onOpenCompare,
  onOpenSource,
  onOpenTarget,
  searchInputRef
}: SchemaTabContentProps) {
  const { t } = useI18n()
  const filteredSchemaDiffs = schemaDiffs.filter((td) =>
    matchesTableSearchQuery(td.table, tableSearchQuery)
  )

  if (schemaDiffs.length === 0) {
    return (
      <EmptyResultState
        title={t('diff.result.noStructureDiffs')}
        description={
          hasRowComparisonResults
            ? t('diff.result.schemaMatchesContentTab')
            : t('diff.result.noSchemaOrPresence')
        }
        action={
          <Button size="sm" variant="secondary" onClick={onClearSearch}>
            {t('diff.result.clearFilters')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          ref={searchInputRef}
          size="sm"
          value={tableSearchQuery}
          onValueChange={(value) => (value ? onSearchChange(value) : onClearSearch())}
          placeholder={t('diff.result.searchTable')}
          clearLabel={t('common.clear')}
          containerClassName="min-w-[12rem] flex-[1_1_16rem]"
        />
        <Badge>{filteredSchemaDiffs.length}</Badge>
      </div>
      {filteredSchemaDiffs.length === 0 ? (
        <EmptyResultState
          title={t('diff.result.noTablesMatch')}
          description={t('diff.result.adjustFilters')}
          action={
            <Button size="sm" variant="secondary" onClick={onClearSearch}>
              {t('diff.result.clearFilters')}
            </Button>
          }
        />
      ) : (
        filteredSchemaDiffs.map((td) => (
          <Panel
            key={td.table}
            padded={false}
            header={
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate font-mono">{td.table}</span>
                <KindBadge kind={td.kind} />
                <span className="text-2xs font-normal text-fg-muted">
                  {t('diff.status.columnDiffCount', { count: td.columnDiffs.length })} ·{' '}
                  {t('diff.status.indexDiffCount', { count: td.indexDiffs.length })}
                  {td.dataDiff ? ` · ${formatDataSummary(td.dataDiff, t)}` : ''}
                </span>
              </span>
            }
            headerActions={
              <TableOpenActions
                compareAvailable={td.kind === 'modified'}
                sourceAvailable={td.kind !== 'only-in-target'}
                targetAvailable={td.kind !== 'only-in-source'}
                onOpenCompare={() => onOpenCompare(td.table)}
                onOpenSource={() => onOpenSource(td.table)}
                onOpenTarget={() => onOpenTarget(td.table)}
              />
            }
          >
            {td.columnDiffs.length > 0 || td.indexDiffs.length > 0 ? (
              <div className="flex flex-col gap-3 p-3">
                {td.columnDiffs.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <DiffColumn
                      title={t('diff.result.sourceColumns')}
                      items={td.columnDiffs.map((d) => ({
                        text: formatColumnLine(d.source, d.kind, 'source'),
                        kind: schemaLineDiffKind(d.kind, 'source')
                      }))}
                    />
                    <DiffColumn
                      title={t('diff.result.targetColumns')}
                      items={td.columnDiffs.map((d) => ({
                        text: formatColumnLine(d.target, d.kind, 'target'),
                        kind: schemaLineDiffKind(d.kind, 'target')
                      }))}
                    />
                  </div>
                ) : null}
                {td.indexDiffs.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <DiffColumn
                      title={t('diff.result.sourceIndexes')}
                      items={td.indexDiffs.map((d) => ({
                        text: formatIndexLine(d.source, d.kind, 'source'),
                        kind: schemaLineDiffKind(d.kind, 'source')
                      }))}
                    />
                    <DiffColumn
                      title={t('diff.result.targetIndexes')}
                      items={td.indexDiffs.map((d) => ({
                        text: formatIndexLine(d.target, d.kind, 'target'),
                        kind: schemaLineDiffKind(d.kind, 'target')
                      }))}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </Panel>
        ))
      )}
    </div>
  )
}
