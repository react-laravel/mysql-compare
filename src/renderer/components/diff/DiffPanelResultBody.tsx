import type { RefObject } from 'react'
import { Button } from '@renderer/components/ui/button'
import type { DatabaseDiff } from '../../../shared/types'
import type { ComparePhase } from './diff-panel-formatters'
import { EmptyResultState } from './diff-panel-presentation'
import { RowComparisonSection } from './RowComparisonSection'
import { SchemaTabContent, StatusTabContent, TablesTabContent } from './DiffResultTabs'
import { useI18n } from '@renderer/i18n'
import type { DiffResultTab, TableCompareEntry, TableStatusFilter } from './diff-panel-utils'

interface DiffPanelResultBodyProps {
  resultTab: DiffResultTab
  compareData: boolean
  comparePhase: ComparePhase
  diff: DatabaseDiff | null
  sourceTables: string[]
  targetTables: string[]
  sharedTableCount: number
  comparisonEntries: TableCompareEntry[]
  prioritizedComparisonEntries: TableCompareEntry[]
  filteredComparisonEntries: TableCompareEntry[]
  completedSharedTableCount: number
  pendingSharedTable?: string
  hasCompareErrors: boolean
  statusFilter: TableStatusFilter
  tableSearchQuery: string
  selectedComparisonTable: string | null
  visibleSchemaDiffs: DatabaseDiff['tableDiffs']
  hasRowComparisonResults: boolean
  showAllRowComparisons: boolean
  onToggleShowAllRowComparisons: () => void
  onSelectComparisonTable: (table: string | null) => void
  onSearchChange: (value: string) => void
  onClearSearch: () => void
  onStatusFilterChange: (value: TableStatusFilter) => void
  onOpenCompare: (table: string) => void
  onOpenSource: (table: string) => void
  onOpenTarget: (table: string) => void
  onRetryTable: (table: string) => void
  onCompare: () => void
  onEnableCompareRows: () => void
  /** ⌘F lands here; only one result tab renders at a time */
  searchInputRef: RefObject<HTMLInputElement | null>
}

export function DiffPanelResultBody({
  resultTab,
  compareData,
  comparePhase,
  diff,
  sourceTables,
  targetTables,
  sharedTableCount,
  comparisonEntries,
  prioritizedComparisonEntries,
  filteredComparisonEntries,
  completedSharedTableCount,
  pendingSharedTable,
  hasCompareErrors,
  statusFilter,
  tableSearchQuery,
  selectedComparisonTable,
  visibleSchemaDiffs,
  hasRowComparisonResults,
  showAllRowComparisons,
  onToggleShowAllRowComparisons,
  onSelectComparisonTable,
  onSearchChange,
  onClearSearch,
  onStatusFilterChange,
  onOpenCompare,
  onOpenSource,
  onOpenTarget,
  onRetryTable,
  onCompare,
  onEnableCompareRows,
  searchInputRef
}: DiffPanelResultBodyProps) {
  const { t } = useI18n()

  if (resultTab === 'tables') {
    return (
      <TablesTabContent
        sourceTables={sourceTables}
        targetTables={targetTables}
        sharedTableCount={sharedTableCount}
        phase={comparePhase}
      />
    )
  }

  if (resultTab === 'status') {
    return (
      <StatusTabContent
        comparisonEntries={comparisonEntries}
        prioritizedComparisonEntries={prioritizedComparisonEntries}
        filteredComparisonEntries={filteredComparisonEntries}
        sharedTableCount={sharedTableCount}
        completedSharedTableCount={completedSharedTableCount}
        pendingSharedTable={pendingSharedTable}
        hasCompareErrors={hasCompareErrors}
        comparePhase={comparePhase}
        statusFilter={statusFilter}
        tableSearchQuery={tableSearchQuery}
        selectedComparisonTable={selectedComparisonTable}
        onSelectTable={onSelectComparisonTable}
        onSearchChange={onSearchChange}
        onClearSearch={onClearSearch}
        onStatusFilterChange={onStatusFilterChange}
        onOpenCompare={onOpenCompare}
        onOpenSource={onOpenSource}
        onOpenTarget={onOpenTarget}
        onRetryTable={onRetryTable}
        searchInputRef={searchInputRef}
      />
    )
  }

  if (resultTab === 'schema') {
    return (
      <SchemaTabContent
        schemaDiffs={visibleSchemaDiffs}
        hasRowComparisonResults={hasRowComparisonResults}
        tableSearchQuery={tableSearchQuery}
        onSearchChange={onSearchChange}
        onClearSearch={onClearSearch}
        onOpenCompare={onOpenCompare}
        onOpenSource={onOpenSource}
        onOpenTarget={onOpenTarget}
        searchInputRef={searchInputRef}
      />
    )
  }

  if (hasRowComparisonResults && diff) {
    return (
      <RowComparisonSection
        rowComparisons={diff.rowComparisons}
        showAll={showAllRowComparisons}
        tableSearchQuery={tableSearchQuery}
        onSearchChange={onSearchChange}
        onClearSearch={onClearSearch}
        onToggleShowAll={onToggleShowAllRowComparisons}
        onOpenCompare={onOpenCompare}
        onOpenSource={onOpenSource}
        onOpenTarget={onOpenTarget}
        searchInputRef={searchInputRef}
      />
    )
  }

  return (
    <EmptyResultState
      title={t('diff.presentation.noContentResults')}
      description={
        compareData
          ? t('diff.presentation.noContentYet')
          : t('diff.presentation.enableCompareRows')
      }
      action={
        compareData ? (
          <Button size="sm" variant="secondary" onClick={onCompare}>
            {t('diff.notice.compareAgain')}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={onEnableCompareRows}>
            {t('diff.toolbar.compareRows')}
          </Button>
        )
      }
    />
  )
}