import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import { api, unwrap } from '@renderer/lib/api'
import type { Translator } from '@renderer/i18n'
import { jobs, useJobStore } from '@renderer/store/job-store'
import { useSettingsStore } from '@renderer/store/settings-store'
import { DIFF_TAB_ID } from '@renderer/store/ui-store'
import type { TableComparisonResult } from '../../../shared/types'
import type { ComparePhase } from './diff-panel-formatters'
import {
  buildInitialComparisonEntries,
  DEFAULT_TABLE_COMPARE_CONCURRENCY,
  DIFF_PANEL_PREFERENCES_KEY,
  parseDiffPanelPreferences,
  runWithConcurrencyLimit,
  updateTableEntry,
  type DiffPanelPreferences,
  type TableCompareEntry
} from './diff-panel-utils'
import { requestTableComparison, supportsIncrementalTableDiff } from './table-diff-request'

type ToastLevel = 'info' | 'error' | 'success'
type ShowToast = (message: string, level?: ToastLevel) => void

export interface CompareContext {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  compareData: boolean
}

export interface SharedTableStats {
  sharedTotal: number
  completed: number
  pending?: string
}

interface UseDiffComparisonArgs {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  compareData: boolean
  tableCompareConcurrency: number
  showToast: ShowToast
  t: Translator
  onBeforeCompare?: () => void
}

interface UseDiffComparisonResult {
  comparePhase: ComparePhase
  compareContext: CompareContext | null
  sourceTables: string[]
  targetTables: string[]
  comparisonEntries: TableCompareEntry[]
  /** How much of the shared-table work is done — drives the toolbar progress. */
  sharedTableStats: SharedTableStats
  showSync: boolean
  setShowSync: Dispatch<SetStateAction<boolean>>
  showAllRowComparisons: boolean
  setShowAllRowComparisons: Dispatch<SetStateAction<boolean>>
  runCompare: () => Promise<void>
  /** DS §7.3 — a compare over 40 tables is never under 1.5s, so Cancel is mandatory. */
  cancelCompare: () => void
  canCancelCompare: boolean
  /** Re-issues the comparison for a single table (the failed row's "Retry"). */
  retryTable: (table: string) => Promise<void>
  removeComparedTable: (event: {
    connectionId: string
    database: string
    table: string
  }) => void
}

export function useStoredDiffPanelPreferences(): [
  DiffPanelPreferences,
  Dispatch<SetStateAction<DiffPanelPreferences>>
] {
  const [preferences, setPreferences] = useState<DiffPanelPreferences>(() =>
    loadStoredDiffPanelPreferences()
  )

  useEffect(() => {
    if (typeof window === 'undefined') return

    window.localStorage.setItem(DIFF_PANEL_PREFERENCES_KEY, JSON.stringify(preferences))
  }, [preferences])

  return [preferences, setPreferences]
}

export function useDatabaseList(
  connectionId: string,
  showToast: ShowToast
): { databases: string[]; loading: boolean } {
  const [databases, setDatabases] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setDatabases([])
    if (!connectionId) {
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    void unwrap(api.db.listDatabases(connectionId))
      .then((list) => {
        if (active) setDatabases(list)
      })
      .catch((err) => {
        if (active) showToast((err as Error).message, 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [connectionId, showToast])

  return { databases, loading }
}

export function computeSharedTableStats(entries: TableCompareEntry[]): SharedTableStats {
  let sharedTotal = 0
  let completed = 0
  let pending: string | undefined

  for (const entry of entries) {
    if (!entry.sourceExists || !entry.targetExists) continue
    sharedTotal += 1
    if (entry.status === 'done' || entry.status === 'error') {
      completed += 1
    } else if (!pending) {
      pending = entry.table
    }
  }

  return { sharedTotal, completed, pending }
}

export function useDiffComparison({
  sourceConnectionId,
  sourceDatabase,
  targetConnectionId,
  targetDatabase,
  compareData,
  tableCompareConcurrency,
  showToast,
  t,
  onBeforeCompare
}: UseDiffComparisonArgs): UseDiffComparisonResult {
  const [comparePhase, setComparePhase] = useState<ComparePhase>('idle')
  const [compareContext, setCompareContext] = useState<CompareContext | null>(null)
  const [sourceTables, setSourceTables] = useState<string[]>([])
  const [targetTables, setTargetTables] = useState<string[]>([])
  const [comparisonEntries, setComparisonEntries] = useState<TableCompareEntry[]>([])
  const [showSync, setShowSync] = useState(false)
  const [showAllRowComparisons, setShowAllRowComparisons] = useState(false)
  const compareRunIdRef = useRef(0)
  const comparePhaseRef = useRef<ComparePhase>('idle')
  const compareJobIdRef = useRef<string | null>(null)

  const setPhase = useCallback((phase: ComparePhase) => {
    comparePhaseRef.current = phase
    setComparePhase(phase)
  }, [])

  const sharedTableStats = useMemo(
    () => computeSharedTableStats(comparisonEntries),
    [comparisonEntries]
  )

  // The status bar and the tab's dot read the same job the toolbar bar renders,
  // so navigating away never hides the fact that a compare is running (§2.10).
  useEffect(() => {
    const jobId = compareJobIdRef.current
    if (!jobId) return
    jobs.update(jobId, {
      count: { done: sharedTableStats.completed, total: sharedTableStats.sharedTotal },
      detail: sharedTableStats.pending
    })
  }, [sharedTableStats])

  const removeComparedTable = useCallback((event: {
    connectionId: string
    database: string
    table: string
  }) => {
    if (!compareContext) return

    const matchesSource =
      event.connectionId === compareContext.sourceConnectionId &&
      event.database === compareContext.sourceDatabase
    const matchesTarget =
      event.connectionId === compareContext.targetConnectionId &&
      event.database === compareContext.targetDatabase

    if (!matchesSource && !matchesTarget) return

    if (matchesSource) {
      setSourceTables((tables) => tables.filter((table) => table !== event.table))
    }
    if (matchesTarget) {
      setTargetTables((tables) => tables.filter((table) => table !== event.table))
    }
    setComparisonEntries((entries) => entries.filter((entry) => entry.table !== event.table))
  }, [compareContext])

  /**
   * The renderer half of cancellation: bumping the run id makes every in-flight
   * per-table response a no-op and stops the loop from issuing more requests
   * (blueprint risk 6 — `diff.table` itself has no cancel channel, so this is
   * the honest limit). Deliberately does **not** touch `job-store`; `job-store`
   * calls this, not the other way around.
   */
  const stopCompare = useCallback(() => {
    if (comparePhaseRef.current !== 'loading-tables' && comparePhaseRef.current !== 'comparing') {
      return
    }
    compareRunIdRef.current += 1
    compareJobIdRef.current = null
    setPhase('cancelled')
  }, [setPhase])

  const cancelCompare = useCallback(() => {
    const jobId = compareJobIdRef.current
    if (jobId) {
      // Routes through the job's own `onCancel`, so the toolbar button, `⌘.`
      // and the status-bar list all take exactly one path.
      useJobStore.getState().cancel(jobId)
      return
    }
    stopCompare()
  }, [stopCompare])

  const runCompare = async () => {
    if (!sourceConnectionId || !targetConnectionId || !sourceDatabase || !targetDatabase) {
      showToast(t('diff.toast.selectEndpoints'), 'error')
      return
    }

    const runId = compareRunIdRef.current + 1
    compareRunIdRef.current = runId
    const nextContext: CompareContext = {
      sourceConnectionId,
      sourceDatabase,
      targetConnectionId,
      targetDatabase,
      compareData
    }

    setShowSync(false)
    setShowAllRowComparisons(false)
    onBeforeCompare?.()
    setCompareContext(nextContext)
    setPhase('loading-tables')
    setSourceTables([])
    setTargetTables([])
    setComparisonEntries([])

    const jobId = jobs.start({
      kind: 'compare',
      tabId: DIFF_TAB_ID,
      label: t('diff.job.comparing', { source: sourceDatabase, target: targetDatabase }),
      onCancel: stopCompare
    })
    compareJobIdRef.current = jobId

    const finishJob = (outcome?: Parameters<typeof jobs.finish>[1]) => {
      if (compareJobIdRef.current !== jobId) return
      compareJobIdRef.current = null
      jobs.finish(jobId, outcome)
    }

    try {
      const [nextSourceTables, nextTargetTables] = await Promise.all([
        unwrap(api.db.listTables(sourceConnectionId, sourceDatabase)),
        unwrap(api.db.listTables(targetConnectionId, targetDatabase))
      ])
      if (compareRunIdRef.current !== runId) return

      const initialEntries = buildInitialComparisonEntries(nextSourceTables, nextTargetTables)
      const sharedTables = initialEntries
        .filter((entry) => entry.sourceExists && entry.targetExists)
        .map((entry) => entry.table)

      setSourceTables(nextSourceTables)
      setTargetTables(nextTargetTables)
      setComparisonEntries(initialEntries)

      if (sharedTables.length === 0) {
        setPhase('done')
        finishJob()
        return
      }

      setPhase('comparing')

      const diffRouter: {
        databases: typeof api.diff.databases
        table?: typeof api.diff.table
      } = api.diff
      const usingCompatibilityMode = !supportsIncrementalTableDiff(diffRouter)

      let failedTables = 0

      await runWithConcurrencyLimit(sharedTables, tableCompareConcurrency, async (table) => {
        if (compareRunIdRef.current !== runId) return

        setComparisonEntries((entries) =>
          updateTableEntry(entries, table, (entry) => ({
            ...entry,
            status: 'comparing',
            error: undefined
          }))
        )

        try {
          const result = await unwrap<TableComparisonResult>(
            requestTableComparison(diffRouter, {
              sourceConnectionId: nextContext.sourceConnectionId,
              sourceDatabase: nextContext.sourceDatabase,
              targetConnectionId: nextContext.targetConnectionId,
              targetDatabase: nextContext.targetDatabase,
              table,
              includeData: nextContext.compareData
            })
          )
          if (compareRunIdRef.current !== runId) return

          setComparisonEntries((entries) =>
            updateTableEntry(entries, table, (entry) => ({
              ...entry,
              status: 'done',
              tableDiff: result.tableDiff,
              rowComparison: result.rowComparison,
              error: undefined
            }))
          )
        } catch (err) {
          failedTables += 1
          if (compareRunIdRef.current !== runId) return

          setComparisonEntries((entries) =>
            updateTableEntry(entries, table, (entry) => ({
              ...entry,
              status: 'error',
              tableDiff: null,
              rowComparison: null,
              error: (err as Error).message
            }))
          )
        }
      })

      if (compareRunIdRef.current !== runId) return

      setPhase('done')
      if (usingCompatibilityMode) {
        showToast(
          t('diff.toast.compatibilityMode'),
          'info'
        )
      }
      if (failedTables > 0) {
        showToast(t('diff.toast.failedTables', { count: failedTables }), 'error')
        finishJob({
          status: 'error',
          detail: t('diff.toast.failedTables', { count: failedTables })
        })
        return
      }
      finishJob()
    } catch (err) {
      if (compareRunIdRef.current !== runId) return
      setCompareContext(null)
      setPhase('idle')
      setSourceTables([])
      setTargetTables([])
      setComparisonEntries([])
      showToast((err as Error).message, 'error')
      finishJob({ status: 'error', detail: (err as Error).message })
    }
  }

  const retryTable = useCallback(
    async (table: string) => {
      if (!compareContext) return

      const runId = compareRunIdRef.current
      setComparisonEntries((entries) =>
        updateTableEntry(entries, table, (entry) => ({
          ...entry,
          status: 'comparing',
          error: undefined
        }))
      )

      try {
        const result = await unwrap<TableComparisonResult>(
          requestTableComparison(api.diff, {
            sourceConnectionId: compareContext.sourceConnectionId,
            sourceDatabase: compareContext.sourceDatabase,
            targetConnectionId: compareContext.targetConnectionId,
            targetDatabase: compareContext.targetDatabase,
            table,
            includeData: compareContext.compareData
          })
        )
        if (compareRunIdRef.current !== runId) return

        setComparisonEntries((entries) =>
          updateTableEntry(entries, table, (entry) => ({
            ...entry,
            status: 'done',
            tableDiff: result.tableDiff,
            rowComparison: result.rowComparison,
            error: undefined
          }))
        )
      } catch (err) {
        if (compareRunIdRef.current !== runId) return

        setComparisonEntries((entries) =>
          updateTableEntry(entries, table, (entry) => ({
            ...entry,
            status: 'error',
            tableDiff: null,
            rowComparison: null,
            error: (err as Error).message
          }))
        )
      }
    },
    [compareContext]
  )

  return {
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
    canCancelCompare: comparePhase === 'loading-tables' || comparePhase === 'comparing',
    retryTable,
    removeComparedTable
  }
}

function loadStoredDiffPanelPreferences(): DiffPanelPreferences {
  if (typeof window === 'undefined') return parseDiffPanelPreferences(null)

  return parseDiffPanelPreferences(window.localStorage.getItem(DIFF_PANEL_PREFERENCES_KEY))
}

/**
 * Parallel workers moved from the diff panel's own localStorage blob to
 * `settings-store` (blueprint §5 chunk 9: "concurrency + compare-rows demoted
 * to `⋯` and Settings"), so the Settings screen is not a control that lies.
 * `diff-panel-utils.ts` is a pure module the chunk leaves untouched, so the
 * legacy field is still parsed and written — it is simply no longer read.
 * This lifts a stored non-default value across once.
 *
 * Exported so the test can drive it deterministically; runs at import.
 */
export function migrateStoredCompareConcurrency(): void {
  if (typeof window === 'undefined' || !window.localStorage) return

  const settings = useSettingsStore.getState()
  // Only ever fills an untouched setting; a value the user picked in Settings
  // always wins over the abandoned copy.
  if (settings.tableCompareConcurrency !== DEFAULT_TABLE_COMPARE_CONCURRENCY) return

  // `parseDiffPanelPreferences` already clamps to a valid option.
  const stored = parseDiffPanelPreferences(
    window.localStorage.getItem(DIFF_PANEL_PREFERENCES_KEY)
  ).tableCompareConcurrency
  if (stored === DEFAULT_TABLE_COMPARE_CONCURRENCY) return

  settings.setTableCompareConcurrency(stored)
}

migrateStoredCompareConcurrency()
