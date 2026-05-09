// 数据库对比面板：先加载两边表列表，再逐表对比并渐进展示结果。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useConnectionStore } from '@renderer/store/connection-store'
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
  parseTableCompareConcurrency,
  prioritizeComparisonEntries,
  TABLE_COMPARE_CONCURRENCY_OPTIONS,
  upsertDiffEndpointHistory,
  type DiffEndpointSelection,
  type DiffResultTab
} from './diff-panel-utils'
import {
  buildDatabaseOptions,
  formatCompareButtonLabel,
  formatCompareSetupSummary
} from './diff-panel-formatters'
import { useI18n } from '@renderer/i18n'
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

export function DiffPanel() {
  const { connections, refresh } = useConnectionStore()
  const { setRightView, showToast, latestTableDropEvent } = useUIStore()
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
  const [compareData, setCompareData] = useState(true)
  const [preferences, setPreferences] = useStoredDiffPanelPreferences()
  const statusFilter = preferences.statusFilter
  const tableCompareConcurrency = preferences.tableCompareConcurrency
  const resultTab = preferences.resultTab
  const setupExpanded = preferences.setupExpanded
  const tableSearchQuery = preferences.tableSearchQuery
  const {
    comparePhase,
    compareContext,
    sourceTables,
    targetTables,
    comparisonEntries,
    showSync,
    setShowSync,
    showAllRowComparisons,
    setShowAllRowComparisons,
    runCompare,
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

  const diff = useMemo<DatabaseDiff | null>(() => {
    if (!compareContext) return null
    return buildDatabaseDiff(compareContext.sourceDatabase, compareContext.targetDatabase, comparisonEntries)
  }, [compareContext, comparisonEntries])

  const connOptions = [
    { value: '', label: '— select —' },
    ...comparableConnections.map((c) => ({ value: c.id, label: c.name }))
  ]
  const selectedSourceConnection = comparableConnections.find((connection) => connection.id === srcId)
  const selectedTargetConnection = comparableConnections.find((connection) => connection.id === tgtId)
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
  const sharedTableStats = useMemo(() => {
    let sharedTotal = 0
    let completed = 0
    let pending: string | undefined
    for (const entry of comparisonEntries) {
      if (!entry.sourceExists || !entry.targetExists) continue
      sharedTotal += 1
      if (entry.status === 'done' || entry.status === 'error') {
        completed += 1
      } else if (!pending) {
        pending = entry.table
      }
    }
    return { sharedTotal, completed, pending }
  }, [comparisonEntries])
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
  }, [compareData, resultTab])

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
  }, [compareData, comparePhase, hasRowComparisonResults, resultTab, visibleSchemaDiffs.length])

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

    setRightView({
      kind: 'table-compare',
      compareSessionId: `${compareContext.sourceConnectionId}:${compareContext.sourceDatabase}:${compareContext.targetConnectionId}:${compareContext.targetDatabase}:${table}`,
      sourceConnectionId: compareContext.sourceConnectionId,
      sourceDatabase: compareContext.sourceDatabase,
      targetConnectionId: compareContext.targetConnectionId,
      targetDatabase: compareContext.targetDatabase,
      table,
      comparedTables: rowComparisonTables,
      diffTables: rowDiffTables
    })
  }

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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <DiffPanelSetupSection
        expanded={setupExpanded}
        summary={compareSetupSummary}
        onToggle={() =>
          setPreferences((current) => ({ ...current, setupExpanded: !current.setupExpanded }))
        }
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

      <DiffPanelToolbar
        compareButtonLabel={formatCompareButtonLabel(
          comparePhase,
          completedSharedTableCount,
          sharedTableCount,
          t
        )}
        compareData={compareData}
        concurrency={tableCompareConcurrency}
        concurrencyOptions={TABLE_COMPARE_CONCURRENCY_OPTIONS}
        diffSummary={diffToolbarSummary}
        loading={loading}
        canPlanSync={comparePhase === 'done' && !!diff && diff.tableDiffs.length > 0}
        onCompare={runCompare}
        onCompareDataChange={setCompareData}
        onConcurrencyChange={(value) =>
          setPreferences((current) => ({
            ...current,
            tableCompareConcurrency: parseTableCompareConcurrency(value)
          }))
        }
        onPlanSync={() => setShowSync(true)}
      />

      <DiffPanelContentArea
        showIdleNotice={comparePhase === 'idle'}
        showResult={!!compareContext}
        resultTab={resultTab}
        tabItems={tabItems}
        onResultTabChange={(value) =>
          setPreferences((current) => ({
            ...current,
            resultTab: value
          }))
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
          />
        }
        identicalNotice={identicalNotice}
        skippedNotice={skippedRowNotice}
      />

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
          diff={diff}
        />
      )}
    </div>
  )
}
