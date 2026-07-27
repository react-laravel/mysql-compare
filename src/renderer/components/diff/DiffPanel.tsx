// 数据库对比面板：先加载两边表列表，再逐表对比并渐进展示结果。
//
// Blueprint §3.5 — the layout is now Toolbar → (setup Panel + result) inside a
// single `ScrollArea`, matching every other view in the app. What changed:
//   · Cancel exists (§2.3) and the compare registers in `job-store`, so the
//     status bar, the tab's dot and `⌘.` all see it;
//   · "Compare rows" and "Parallel workers" moved to the toolbar `⋯` and read
//     `settings-store`, which is the same value the Settings screen edits;
//   · the source endpoint can be prefilled from a database row's
//     "Compare this database…" (§2.2 entrance 3);
//   · `⌘R` re-runs the comparison and `⌘F` focuses the table filter.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRightLeft, Download, RefreshCw, Trash2 } from 'lucide-react'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import type { MenuItem } from '@renderer/components/ui/dropdown-menu'
import type { ProgressState } from '@renderer/components/ui/progress-bar'
import { useAppAction } from '@renderer/lib/app-actions'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSettingsStore } from '@renderer/store/settings-store'
import { useUIStore } from '@renderer/store/ui-store'
import type { DatabaseDiff } from '../../../shared/types'
import {
  buildDatabaseDiff,
  filterChangedRowComparisons,
  filterComparisonEntries,
  filterDiffEndpointHistoryByConnections,
  createDiffEndpointHistoryKey,
  getPreferredComparisonTable,
  hasCompleteDiffEndpointSelection,
  hasSchemaOrPresenceDiff,
  hasNoRowDifferences,
  prioritizeComparisonEntries,
  TABLE_COMPARE_CONCURRENCY_OPTIONS,
  upsertDiffEndpointHistory,
  type DiffEndpointSelection
} from './diff-panel-utils'
import {
  buildDatabaseOptions,
  formatCompareButtonLabel,
  formatComparePhase,
  formatCompareSetupSummary
} from './diff-panel-formatters'
import { useI18n } from '@renderer/i18n'
import { buildTableCompareView } from './table-compare-session'
import { SyncPanel } from './SyncPanel'
import { DiffPanelContentArea } from './DiffPanelContentArea'
import { DiffPanelResultBody } from './DiffPanelResultBody'
import { DiffPanelSetupSection } from './DiffPanelSetupSection'
import { DiffPanelToolbar } from './DiffPanelToolbar'
import {
  buildDiffPanelTabItems,
  buildDiffPanelToolbarSummary,
  getDiffPanelSkippedRowNotice,
  getFullyIdenticalNotice
} from './diff-panel-view-state'
import {
  useDatabaseList,
  useDiffComparison,
  useStoredDiffPanelPreferences
} from './diff-panel-hooks'

interface DiffPanelProps {
  /** the workspace keeps every tab mounted; only the visible one takes ⌘R / ⌘F */
  active?: boolean
}

export function DiffPanel({ active = true }: DiffPanelProps) {
  const { connections, refresh } = useConnectionStore()
  const { setRightView, showToast, latestTableDropEvent, latestDiffPrefillRequest } = useUIStore()
  const { t } = useI18n()

  const restoredEndpointHistoryRef = useRef(false)
  const [srcId, setSrcId] = useState('')
  const [tgtId, setTgtId] = useState('')
  const [srcDb, setSrcDb] = useState('')
  const [tgtDb, setTgtDb] = useState('')
  const [connectionsReady, setConnectionsReady] = useState(false)
  const { databases: srcDbs, loading: srcDbsLoading } = useDatabaseList(srcId, showToast)
  const { databases: tgtDbs, loading: tgtDbsLoading } = useDatabaseList(tgtId, showToast)
  const [selectedComparisonTable, setSelectedComparisonTable] = useState<string | null>(null)
  const [preferences, setPreferences] = useStoredDiffPanelPreferences()
  // Both of these left the primary surface for the `⋯` and Settings; the store
  // is the single value the Settings screen edits, so the control cannot lie.
  const compareData = useSettingsStore((state) => state.compareRows)
  const setCompareData = useSettingsStore((state) => state.setCompareRows)
  const tableCompareConcurrency = useSettingsStore((state) => state.tableCompareConcurrency)
  const setTableCompareConcurrency = useSettingsStore(
    (state) => state.setTableCompareConcurrency
  )
  const statusFilter = preferences.statusFilter
  const resultTab = preferences.resultTab
  const setupExpanded = preferences.setupExpanded
  const tableSearchQuery = preferences.tableSearchQuery
  const targetConnectionRef = useRef<HTMLSelectElement>(null)
  // Only one result tab renders at a time, so a single ref serves ⌘F on all of
  // them (§4.2: "focus the current view's filter").
  const filterInputRef = useRef<HTMLInputElement>(null)
  const {
    comparePhase,
    compareContext,
    sourceTables,
    targetTables,
    comparisonEntries,
    sharedTableStats,
    showSync,
    setShowSync,
    showAllRowComparisons,
    setShowAllRowComparisons,
    runCompare,
    cancelCompare,
    canCancelCompare,
    retryTable,
    removeComparedTable
  } = useDiffComparison({
    sourceConnectionId: srcId,
    sourceDatabase: srcDb,
    targetConnectionId: tgtId,
    targetDatabase: tgtDb,
    compareData,
    tableCompareConcurrency,
    showToast,
    t,
    onBeforeCompare: () => {
      const endpointSelection: DiffEndpointSelection = {
        sourceConnectionId: srcId,
        sourceDatabase: srcDb,
        targetConnectionId: tgtId,
        targetDatabase: tgtDb
      }
      setSelectedComparisonTable(null)
      setPreferences((current) => ({
        ...current,
        resultTab: 'status',
        setupExpanded: false,
        endpointHistory: upsertDiffEndpointHistory(current.endpointHistory, endpointSelection)
      }))
    }
  })
  const handledTableDropEventIdRef = useRef(0)
  const handledPrefillIdRef = useRef(0)

  useEffect(() => {
    if (!latestTableDropEvent) return
    if (latestTableDropEvent.id <= handledTableDropEventIdRef.current) return

    handledTableDropEventIdRef.current = latestTableDropEvent.id
    removeComparedTable(latestTableDropEvent)
    setSelectedComparisonTable((current) =>
      current === latestTableDropEvent.table ? null : current
    )
  }, [latestTableDropEvent, removeComparedTable])

  useEffect(() => {
    let active = true
    setConnectionsReady(false)
    void refresh()
      .catch((err) => showToast((err as Error).message, 'error'))
      .finally(() => {
        if (active) setConnectionsReady(true)
      })
    return () => {
      active = false
    }
  }, [refresh, showToast])

  const comparableConnections = useMemo(
    () => connections.filter((connection) => connection.engine !== 'redis'),
    [connections]
  )
  const connectionIds = useMemo(
    () => new Set(comparableConnections.map((connection) => connection.id)),
    [comparableConnections]
  )
  const connectionNameById = useMemo(
    () => new Map(comparableConnections.map((connection) => [connection.id, connection.name])),
    [comparableConnections]
  )
  const validEndpointHistory = useMemo(
    () => filterDiffEndpointHistoryByConnections(preferences.endpointHistory, connectionIds),
    [connectionIds, preferences.endpointHistory]
  )

  useEffect(() => {
    if (restoredEndpointHistoryRef.current || !connectionsReady) return
    restoredEndpointHistoryRef.current = true
    if (srcId || srcDb || tgtId || tgtDb) return

    const [latestHistory] = validEndpointHistory
    if (!latestHistory) return

    setSrcId(latestHistory.sourceConnectionId)
    setSrcDb(latestHistory.sourceDatabase)
    setTgtId(latestHistory.targetConnectionId)
    setTgtDb(latestHistory.targetDatabase)
  }, [connectionsReady, srcDb, srcId, tgtDb, tgtId, validEndpointHistory])

  // §2.2 entrance 3: a database row's "Compare this database…" prefills the
  // source, expands setup and lands focus on the *target* connection — the one
  // thing the user still has to choose.
  useEffect(() => {
    if (!latestDiffPrefillRequest) return
    if (latestDiffPrefillRequest.id <= handledPrefillIdRef.current) return

    handledPrefillIdRef.current = latestDiffPrefillRequest.id
    restoredEndpointHistoryRef.current = true
    setSrcId(latestDiffPrefillRequest.connectionId)
    setSrcDb(latestDiffPrefillRequest.database)
    setPreferences((current) => ({ ...current, setupExpanded: true }))
    requestAnimationFrame(() => targetConnectionRef.current?.focus())
  }, [latestDiffPrefillRequest, setPreferences])

  const diff = useMemo<DatabaseDiff | null>(() => {
    if (!compareContext) return null
    return buildDatabaseDiff(
      compareContext.sourceDatabase,
      compareContext.targetDatabase,
      comparisonEntries
    )
  }, [compareContext, comparisonEntries])

  const connOptions = [
    { value: '', label: '— select —' },
    ...comparableConnections.map((c) => ({ value: c.id, label: c.name }))
  ]
  const selectedSourceConnection = comparableConnections.find(
    (connection) => connection.id === srcId
  )
  const selectedTargetConnection = comparableConnections.find(
    (connection) => connection.id === tgtId
  )
  const sourceConnection = comparableConnections.find(
    (connection) => connection.id === (compareContext?.sourceConnectionId ?? srcId)
  )
  const targetConnection = comparableConnections.find(
    (connection) => connection.id === (compareContext?.targetConnectionId ?? tgtId)
  )
  const loading = comparePhase === 'loading-tables' || comparePhase === 'comparing'
  const visibleSchemaDiffs = diff?.tableDiffs.filter(hasSchemaOrPresenceDiff) ?? []
  const filteredComparisonEntries = useMemo(
    () => filterComparisonEntries(comparisonEntries, statusFilter, tableSearchQuery),
    [comparisonEntries, statusFilter, tableSearchQuery]
  )
  const prioritizedComparisonEntries = useMemo(
    () => prioritizeComparisonEntries(filteredComparisonEntries),
    [filteredComparisonEntries]
  )
  const compareErrorCount = comparisonEntries.reduce(
    (count, entry) => (entry.status === 'error' ? count + 1 : count),
    0
  )
  const hasCompareErrors = compareErrorCount > 0
  const fullyIdentical = diff
    ? comparePhase === 'done' &&
      !hasCompareErrors &&
      diff.tableDiffs.length === 0 &&
      (!compareContext?.compareData || diff.rowComparisons.every(hasNoRowDifferences))
    : false
  const hasSkippedRowComparison =
    diff?.rowComparisons.some(({ dataDiff }) => !dataDiff.comparable) ?? false
  const sharedTableCount = sharedTableStats.sharedTotal
  const completedSharedTableCount = sharedTableStats.completed
  const pendingSharedTable = sharedTableStats.pending
  const hasRowComparisonResults = compareData && !!diff && diff.rowComparisons.length > 0
  const changedRowComparisons = useMemo(
    () => (diff ? filterChangedRowComparisons(diff.rowComparisons) : []),
    [diff]
  )
  const rowChangedTableCount = changedRowComparisons.length
  const rowSkippedTableCount = diff
    ? diff.rowComparisons.filter((rowComparison) => !rowComparison.dataDiff.comparable).length
    : 0
  const rowComparisonTables = diff?.rowComparisons.map((rowComparison) => rowComparison.table) ?? []
  const rowDiffTables = changedRowComparisons.map((rowComparison) => rowComparison.table)
  const compareSetupSummary = formatCompareSetupSummary(
    {
      sourceConnectionName: selectedSourceConnection?.name,
      sourceDatabase: srcDb,
      targetConnectionName: selectedTargetConnection?.name,
      targetDatabase: tgtDb,
      compareData
    },
    t
  )
  const sourceDatabaseOptions = buildDatabaseOptions(srcId, srcDbs, srcDbsLoading, t)
  const targetDatabaseOptions = buildDatabaseOptions(tgtId, tgtDbs, tgtDbsLoading, t)
  const currentEndpointSelection: DiffEndpointSelection = {
    sourceConnectionId: srcId,
    sourceDatabase: srcDb,
    targetConnectionId: tgtId,
    targetDatabase: tgtDb
  }
  const currentEndpointHistoryKey = hasCompleteDiffEndpointSelection(currentEndpointSelection)
    ? createDiffEndpointHistoryKey(currentEndpointSelection)
    : ''
  const endpointHistoryItems = useMemo(
    () =>
      validEndpointHistory.map((item) => {
        const sourceName =
          connectionNameById.get(item.sourceConnectionId) ?? item.sourceConnectionId
        const targetName =
          connectionNameById.get(item.targetConnectionId) ?? item.targetConnectionId
        return {
          value: createDiffEndpointHistoryKey(item),
          label: `${sourceName} / ${item.sourceDatabase} -> ${targetName} / ${item.targetDatabase}`
        }
      }),
    [connectionNameById, validEndpointHistory]
  )
  const selectedEndpointHistoryValue = endpointHistoryItems.some(
    (option) => option.value === currentEndpointHistoryKey
  )
    ? currentEndpointHistoryKey
    : ''

  const handleSourceConnectionChange = (value: string) => {
    setSrcId(value)
    setSrcDb('')
  }

  const handleTargetConnectionChange = (value: string) => {
    setTgtId(value)
    setTgtDb('')
  }

  const handleEndpointHistoryChange = (value: string) => {
    const historyItem = validEndpointHistory.find(
      (item) => createDiffEndpointHistoryKey(item) === value
    )
    if (!historyItem) return

    setSrcId(historyItem.sourceConnectionId)
    setSrcDb(historyItem.sourceDatabase)
    setTgtId(historyItem.targetConnectionId)
    setTgtDb(historyItem.targetDatabase)
  }

  const handleDeleteEndpointHistory = (value: string) => {
    setPreferences((current) => ({
      ...current,
      endpointHistory: current.endpointHistory.filter(
        (item) => createDiffEndpointHistoryKey(item) !== value
      )
    }))
  }

  useEffect(() => {
    const preferredTable = getPreferredComparisonTable(
      prioritizedComparisonEntries,
      selectedComparisonTable
    )
    if (preferredTable !== selectedComparisonTable) {
      setSelectedComparisonTable(preferredTable)
    }
  }, [prioritizedComparisonEntries, selectedComparisonTable])

  useEffect(() => {
    if (!compareData && resultTab === 'data') {
      setPreferences((current) => ({ ...current, resultTab: 'status' }))
    }
  }, [compareData, resultTab, setPreferences])

  useEffect(() => {
    if (
      resultTab === 'schema' &&
      comparePhase === 'done' &&
      compareData &&
      visibleSchemaDiffs.length === 0 &&
      hasRowComparisonResults
    ) {
      setPreferences((current) => ({ ...current, resultTab: 'data' }))
    }
  }, [
    compareData,
    comparePhase,
    hasRowComparisonResults,
    resultTab,
    setPreferences,
    visibleSchemaDiffs.length
  ])

  const openComparedTable = (side: 'source' | 'target', table: string) => {
    if (!compareContext) return

    const connectionId =
      side === 'source' ? compareContext.sourceConnectionId : compareContext.targetConnectionId
    const database =
      side === 'source' ? compareContext.sourceDatabase : compareContext.targetDatabase

    setRightView({ kind: 'table', connectionId, database, table })
  }

  const openCompareView = (table: string) => {
    if (!compareContext) return

    // Same builder the table row's "Compare with…" uses, so both entrances
    // land on one tab per pair (blueprint §2.4).
    setRightView(
      buildTableCompareView(
        {
          sourceConnectionId: compareContext.sourceConnectionId,
          sourceDatabase: compareContext.sourceDatabase,
          targetConnectionId: compareContext.targetConnectionId,
          targetDatabase: compareContext.targetDatabase,
          table
        },
        { comparedTables: rowComparisonTables, diffTables: rowDiffTables }
      )
    )
  }

  const startCompare = () => {
    void runCompare()
  }

  const swapEndpoints = () => {
    setSrcId(tgtId)
    setSrcDb(tgtDb)
    setTgtId(srcId)
    setTgtDb(srcDb)
  }

  const clearEndpointHistory = () => {
    setPreferences((current) => ({ ...current, endpointHistory: [] }))
  }

  /**
   * There is no file-save channel in `AppAPI`, so "export" is an honest copy of
   * the machine-readable diff to the clipboard rather than a save dialog that
   * does not exist.
   */
  const exportDiffReport = () => {
    if (!diff) return
    void navigator.clipboard
      .writeText(JSON.stringify(diff, null, 2))
      .then(() => showToast(t('diff.toolbar.reportCopied'), 'success'))
      .catch((err) => showToast((err as Error).message, 'error'))
  }

  useAppAction('refresh-view', active && !loading ? startCompare : null)
  useAppAction('focus-filter', active ? () => filterInputRef.current?.focus() : null)

  const tabItems = buildDiffPanelTabItems(
    {
      sourceTableCount: sourceTables.length,
      targetTableCount: targetTables.length,
      comparisonEntryCount: comparisonEntries.length,
      compareErrorCount,
      visibleSchemaDiffCount: visibleSchemaDiffs.length,
      compareData,
      rowChangedTableCount,
      rowSkippedTableCount
    },
    t
  )
  const diffToolbarSummary = buildDiffPanelToolbarSummary({
    diff,
    comparePhase,
    rowChangedTableCount,
    rowSkippedTableCount
  })
  const identicalNotice = diff && fullyIdentical ? getFullyIdenticalNotice(compareData, t) : null
  const skippedRowNotice =
    diff &&
    compareData &&
    diff.tableDiffs.length === 0 &&
    hasSkippedRowComparison &&
    !fullyIdentical
      ? getDiffPanelSkippedRowNotice(t)
      : null

  const canPlanSync = comparePhase === 'done' && !!diff && diff.tableDiffs.length > 0
  const hasRowDifferencesToShow = compareData && rowChangedTableCount > 0

  const progress: ProgressState | null = loading
    ? {
        status: 'running',
        count:
          sharedTableCount > 0
            ? { done: completedSharedTableCount, total: sharedTableCount }
            : undefined,
        detail: pendingSharedTable
      }
    : null

  const overflow: MenuItem[] = [
    {
      kind: 'checkbox',
      id: 'compare-rows',
      label: t('diff.toolbar.compareRows'),
      checked: compareData,
      onSelect: () => setCompareData(!compareData)
    },
    {
      kind: 'submenu',
      id: 'concurrency',
      label: t('diff.toolbar.parallel'),
      items: TABLE_COMPARE_CONCURRENCY_OPTIONS.map((value) => ({
        kind: 'checkbox' as const,
        id: `concurrency-${value}`,
        label: String(value),
        checked: value === tableCompareConcurrency,
        disabled: loading,
        onSelect: () => setTableCompareConcurrency(value)
      }))
    },
    { kind: 'separator', id: 'sep-1' },
    {
      id: 'rerun',
      icon: RefreshCw,
      label: t('diff.toolbar.rerun'),
      shortcut: 'Mod+R',
      disabled: loading || !compareContext,
      onSelect: startCompare
    },
    {
      id: 'swap',
      icon: ArrowRightLeft,
      label: t('diff.toolbar.swapEndpoints'),
      disabled: loading || (!srcId && !tgtId),
      onSelect: swapEndpoints
    },
    {
      id: 'show-row-diffs',
      label: t('diff.notice.showRowDiffs'),
      disabled: !hasRowDifferencesToShow,
      disabledReason: t('diff.toolbar.noRowDifferences'),
      onSelect: () => setPreferences((current) => ({ ...current, resultTab: 'data' }))
    },
    { kind: 'separator', id: 'sep-2' },
    {
      id: 'export-report',
      icon: Download,
      label: t('diff.toolbar.exportReport'),
      disabled: !diff,
      disabledReason: t('diff.toolbar.noResultYet'),
      onSelect: exportDiffReport
    },
    {
      id: 'clear-history',
      icon: Trash2,
      label: t('diff.history.clear'),
      disabled: preferences.endpointHistory.length === 0,
      onSelect: clearEndpointHistory
    }
  ]

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <DiffPanelToolbar
        subtitle={compareSetupSummary}
        compareButtonLabel={formatCompareButtonLabel(
          comparePhase,
          completedSharedTableCount,
          sharedTableCount,
          t
        )}
        compareData={compareData}
        diffSummary={diffToolbarSummary}
        loading={loading}
        canCancel={canCancelCompare}
        canPlanSync={canPlanSync}
        planSyncDisabledReason={t('diff.toolbar.planSyncDisabled')}
        progress={progress}
        progressLabel={
          loading
            ? formatComparePhase(
                comparePhase,
                completedSharedTableCount,
                sharedTableCount,
                pendingSharedTable,
                t
              )
            : null
        }
        overflow={overflow}
        onCompare={startCompare}
        onCancel={cancelCompare}
        onPlanSync={() => setShowSync(true)}
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-w-0 flex-col gap-3 p-3">
          <DiffPanelSetupSection
            expanded={setupExpanded}
            summary={compareSetupSummary}
            onToggle={() =>
              setPreferences((current) => ({ ...current, setupExpanded: !current.setupExpanded }))
            }
            targetConnectionRef={targetConnectionRef}
            history={{
              items: endpointHistoryItems,
              activeValue: selectedEndpointHistoryValue,
              onSelect: handleEndpointHistoryChange,
              onDelete: handleDeleteEndpointHistory
            }}
            source={{
              connectionName: selectedSourceConnection?.name,
              database: srcDb,
              connectionOptions: connOptions,
              connectionValue: srcId,
              onConnectionChange: handleSourceConnectionChange,
              databaseOptions: sourceDatabaseOptions,
              databaseValue: srcDb,
              databaseDisabled: !srcId || srcDbsLoading,
              databaseLoading: srcDbsLoading,
              onDatabaseChange: setSrcDb
            }}
            target={{
              connectionName: selectedTargetConnection?.name,
              database: tgtDb,
              connectionOptions: connOptions,
              connectionValue: tgtId,
              onConnectionChange: handleTargetConnectionChange,
              databaseOptions: targetDatabaseOptions,
              databaseValue: tgtDb,
              databaseDisabled: !tgtId || tgtDbsLoading,
              databaseLoading: tgtDbsLoading,
              onDatabaseChange: setTgtDb
            }}
          />

          <DiffPanelContentArea
            showIdleNotice={comparePhase === 'idle' && !compareContext}
            showResult={!!compareContext}
            compareDisabled={loading}
            onCompare={startCompare}
            resultTab={resultTab}
            tabItems={tabItems}
            onResultTabChange={(value) =>
              setPreferences((current) => ({
                ...current,
                resultTab: value
              }))
            }
            identicalNotice={identicalNotice}
            skippedNotice={skippedRowNotice}
            onShowRowDiffs={
              compareData
                ? () => setPreferences((current) => ({ ...current, resultTab: 'data' }))
                : null
            }
            resultBody={
              <DiffPanelResultBody
                resultTab={resultTab}
                compareData={compareData}
                comparePhase={comparePhase}
                diff={diff}
                sourceTables={sourceTables}
                targetTables={targetTables}
                sharedTableCount={sharedTableCount}
                comparisonEntries={comparisonEntries}
                prioritizedComparisonEntries={prioritizedComparisonEntries}
                filteredComparisonEntries={filteredComparisonEntries}
                completedSharedTableCount={completedSharedTableCount}
                pendingSharedTable={pendingSharedTable}
                hasCompareErrors={hasCompareErrors}
                statusFilter={statusFilter}
                tableSearchQuery={tableSearchQuery}
                selectedComparisonTable={selectedComparisonTable}
                visibleSchemaDiffs={visibleSchemaDiffs}
                hasRowComparisonResults={hasRowComparisonResults}
                showAllRowComparisons={showAllRowComparisons}
                onToggleShowAllRowComparisons={() =>
                  setShowAllRowComparisons((current) => !current)
                }
                onSelectComparisonTable={setSelectedComparisonTable}
                onSearchChange={(value) =>
                  setPreferences((current) => ({ ...current, tableSearchQuery: value }))
                }
                onClearSearch={() =>
                  setPreferences((current) => ({ ...current, tableSearchQuery: '' }))
                }
                onStatusFilterChange={(value) =>
                  setPreferences((current) => ({ ...current, statusFilter: value }))
                }
                onOpenCompare={openCompareView}
                onOpenSource={(table) => openComparedTable('source', table)}
                onOpenTarget={(table) => openComparedTable('target', table)}
                onRetryTable={(table) => {
                  void retryTable(table)
                }}
                onCompare={startCompare}
                onEnableCompareRows={() => setCompareData(true)}
                searchInputRef={filterInputRef}
              />
            }
          />
        </div>
      </ScrollArea>

      {showSync && diff && (
        <SyncPanel
          open
          onClose={() => setShowSync(false)}
          source={{
            connectionId: compareContext?.sourceConnectionId ?? srcId,
            database: compareContext?.sourceDatabase ?? srcDb
          }}
          target={{
            connectionId: compareContext?.targetConnectionId ?? tgtId,
            database: compareContext?.targetDatabase ?? tgtDb
          }}
          sourceEngine={sourceConnection?.engine ?? 'mysql'}
          targetEngine={targetConnection?.engine ?? 'mysql'}
          targetConnectionName={targetConnection?.name}
          diff={diff}
        />
      )}
    </div>
  )
}
