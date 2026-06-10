import type { DatabaseDiff, TableDiff, TableRowComparison } from '../../../shared/types'

export const TABLE_COMPARE_CONCURRENCY_OPTIONS = [1, 5, 10, 20, 50] as const
export const DEFAULT_TABLE_COMPARE_CONCURRENCY = 5
export const DEFAULT_TABLE_STATUS_FILTER = 'all'
export const DEFAULT_DIFF_RESULT_TAB = 'status'
export const DEFAULT_COMPARE_SETUP_EXPANDED = true
export const DEFAULT_TABLE_SEARCH_QUERY = ''
export const DIFF_PANEL_PREFERENCES_KEY = 'mysql-compare:diff-panel-preferences'
export const MAX_DIFF_ENDPOINT_HISTORY = 8

export type TableCompareStatus = 'queued' | 'comparing' | 'done' | 'error'
export type TableStatusFilter = 'all' | 'comparing' | 'changed' | 'schema-changed' | 'row-changed'
export type DiffResultTab = 'tables' | 'status' | 'schema' | 'data'

export interface DiffPanelPreferences {
  statusFilter: TableStatusFilter
  tableCompareConcurrency: number
  resultTab: DiffResultTab
  setupExpanded: boolean
  tableSearchQuery: string
  endpointHistory: DiffEndpointHistoryItem[]
}

export interface DiffEndpointSelection {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
}

export interface DiffEndpointHistoryItem extends DiffEndpointSelection {
  updatedAt: number
}

export interface TableCompareEntry {
  table: string
  sourceExists: boolean
  targetExists: boolean
  status: TableCompareStatus
  tableDiff: TableDiff | null
  rowComparison: TableRowComparison | null
  error?: string
}

export function buildInitialComparisonEntries(
  sourceTables: string[],
  targetTables: string[]
): TableCompareEntry[] {
  const sourceSet = new Set(sourceTables)
  const targetSet = new Set(targetTables)

  return Array.from(new Set([...sourceTables, ...targetTables]))
    .sort((left, right) => left.localeCompare(right))
    .map((table) => {
      const sourceExists = sourceSet.has(table)
      const targetExists = targetSet.has(table)

      if (sourceExists && !targetExists) {
        return {
          table,
          sourceExists,
          targetExists,
          status: 'done',
          tableDiff: { table, kind: 'only-in-source', columnDiffs: [], indexDiffs: [] },
          rowComparison: null
        } satisfies TableCompareEntry
      }

      if (!sourceExists && targetExists) {
        return {
          table,
          sourceExists,
          targetExists,
          status: 'done',
          tableDiff: { table, kind: 'only-in-target', columnDiffs: [], indexDiffs: [] },
          rowComparison: null
        } satisfies TableCompareEntry
      }

      return {
        table,
        sourceExists,
        targetExists,
        status: 'queued',
        tableDiff: null,
        rowComparison: null
      } satisfies TableCompareEntry
    })
}

export function buildDatabaseDiff(
  sourceDatabase: string,
  targetDatabase: string,
  entries: TableCompareEntry[]
): DatabaseDiff {
  return {
    sourceDatabase,
    targetDatabase,
    tableDiffs: entries.flatMap((entry) => (entry.tableDiff ? [entry.tableDiff] : [])),
    rowComparisons: entries.flatMap((entry) => (entry.rowComparison ? [entry.rowComparison] : []))
  }
}

export function updateTableEntry(
  entries: TableCompareEntry[],
  table: string,
  update: (entry: TableCompareEntry) => TableCompareEntry
): TableCompareEntry[] {
  return entries.map((entry) => (entry.table === table ? update(entry) : entry))
}

export async function runWithConcurrencyLimit<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return

  const workerCount = Math.min(Math.max(concurrency, 1), items.length)
  let nextIndex = 0

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex]
        nextIndex += 1
        if (item === undefined) return
        await worker(item)
      }
    })
  )
}

export function hasNoRowDifferences({ dataDiff }: TableRowComparison): boolean {
  return (
    dataDiff.comparable &&
    dataDiff.sourceOnly === 0 &&
    dataDiff.targetOnly === 0 &&
    dataDiff.modified === 0
  )
}

export function filterChangedRowComparisons(
  rowComparisons: TableRowComparison[]
): TableRowComparison[] {
  return rowComparisons.filter(
    (rowComparison) => rowComparison.dataDiff.comparable && !hasNoRowDifferences(rowComparison)
  )
}

export function getRowDiffNavigation(
  comparedTables: string[],
  diffTables: string[],
  currentTable: string
): {
  previousTable: string | null
  nextTable: string | null
  currentDiffPosition: number | null
  totalDiffTables: number
} {
  const orderedComparedTables = Array.from(new Set(comparedTables))
  const orderedDiffTables = getOrderedDiffTables(orderedComparedTables, diffTables)

  if (orderedDiffTables.length === 0) {
    return {
      previousTable: null,
      nextTable: null,
      currentDiffPosition: null,
      totalDiffTables: 0
    }
  }

  const currentDiffIndex = orderedDiffTables.indexOf(currentTable)
  if (currentDiffIndex >= 0) {
    return {
      previousTable: orderedDiffTables[currentDiffIndex - 1] ?? null,
      nextTable: orderedDiffTables[currentDiffIndex + 1] ?? null,
      currentDiffPosition: currentDiffIndex + 1,
      totalDiffTables: orderedDiffTables.length
    }
  }

  const currentComparedIndex = orderedComparedTables.indexOf(currentTable)
  if (currentComparedIndex < 0) {
    return {
      previousTable: null,
      nextTable: orderedDiffTables[0] ?? null,
      currentDiffPosition: null,
      totalDiffTables: orderedDiffTables.length
    }
  }

  let previousTable: string | null = null
  let nextTable: string | null = null

  for (const table of orderedDiffTables) {
    const diffTableIndex = orderedComparedTables.indexOf(table)
    if (diffTableIndex < currentComparedIndex) {
      previousTable = table
      continue
    }
    if (diffTableIndex > currentComparedIndex) {
      nextTable = table
      break
    }
  }

  return {
    previousTable,
    nextTable,
    currentDiffPosition: null,
    totalDiffTables: orderedDiffTables.length
  }
}

export function getUpcomingRowDiffTables(
  comparedTables: string[],
  diffTables: string[],
  currentTable: string,
  limit: number
): string[] {
  if (limit <= 0) return []

  const orderedComparedTables = Array.from(new Set(comparedTables))
  const orderedDiffTables = getOrderedDiffTables(orderedComparedTables, diffTables)
  if (orderedDiffTables.length === 0) return []

  const currentDiffIndex = orderedDiffTables.indexOf(currentTable)
  if (currentDiffIndex >= 0) {
    return orderedDiffTables.slice(currentDiffIndex + 1, currentDiffIndex + 1 + limit)
  }

  const currentComparedIndex = orderedComparedTables.indexOf(currentTable)
  if (currentComparedIndex < 0) {
    return orderedDiffTables.slice(0, limit)
  }

  return orderedDiffTables
    .filter((table) => orderedComparedTables.indexOf(table) > currentComparedIndex)
    .slice(0, limit)
}

function getOrderedDiffTables(comparedTables: string[], diffTables: string[]): string[] {
  const fallbackDiffTables = Array.from(new Set(diffTables))
  const diffSet = new Set(fallbackDiffTables)

  return comparedTables.length > 0
    ? comparedTables.filter((table) => diffSet.has(table))
    : fallbackDiffTables
}

export function filterComparisonEntries(
  entries: TableCompareEntry[],
  filter: TableStatusFilter,
  searchQuery = ''
): TableCompareEntry[] {
  const filteredByStatus = applyStatusFilter(entries, filter)
  return filteredByStatus.filter((entry) => matchesTableSearchQuery(entry.table, searchQuery))
}

export function matchesTableSearchQuery(table: string, searchQuery: string): boolean {
  const normalizedQuery = searchQuery.trim().toLowerCase()
  if (!normalizedQuery) return true
  return table.toLowerCase().includes(normalizedQuery)
}

function applyStatusFilter(
  entries: TableCompareEntry[],
  filter: TableStatusFilter
): TableCompareEntry[] {
  switch (filter) {
    case 'all':
      return entries
    case 'comparing':
      return entries.filter((entry) => entry.status === 'comparing')
    case 'schema-changed':
      return entries.filter(hasSchemaChangedEntry)
    case 'row-changed':
      return entries.filter(hasRowChangedEntry)
    case 'changed':
      return entries.filter(hasChangedEntry)
  }
}

export function prioritizeComparisonEntries(entries: TableCompareEntry[]): TableCompareEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const byName = left.entry.table.localeCompare(right.entry.table)
      if (byName !== 0) return byName
      return left.index - right.index
    })
    .map(({ entry }) => entry)
}

export function getPreferredComparisonTable(
  entries: TableCompareEntry[],
  currentTable: string | null
): string | null {
  if (currentTable && entries.some((entry) => entry.table === currentTable)) {
    return currentTable
  }

  return (
    entries.find((entry) => entry.status === 'comparing')?.table ??
    entries.find((entry) => entry.status === 'queued')?.table ??
    entries.find((entry) => entry.status === 'error')?.table ??
    entries[0]?.table ??
    null
  )
}

export function parseTableCompareConcurrency(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return TABLE_COMPARE_CONCURRENCY_OPTIONS.includes(
    parsed as (typeof TABLE_COMPARE_CONCURRENCY_OPTIONS)[number]
  )
    ? parsed
    : DEFAULT_TABLE_COMPARE_CONCURRENCY
}

export function parseDiffPanelPreferences(raw: string | null | undefined): DiffPanelPreferences {
  if (!raw) return createDefaultDiffPanelPreferences()

  try {
    const parsed = JSON.parse(raw) as {
      statusFilter?: unknown
      tableCompareConcurrency?: unknown
      resultTab?: unknown
      setupExpanded?: unknown
      sourceTablesExpanded?: unknown
      targetTablesExpanded?: unknown
      tableSearchQuery?: unknown
      endpointHistory?: unknown
    }
    const legacyTablesVisible =
      parsed.sourceTablesExpanded === true || parsed.targetTablesExpanded === true
    const hasExplicitResultTab = isDiffResultTab(parsed.resultTab)

    return {
      statusFilter: parseTableStatusFilter(parsed.statusFilter),
      tableCompareConcurrency: parseTableCompareConcurrency(
        String(parsed.tableCompareConcurrency ?? '')
      ),
      resultTab:
        !hasExplicitResultTab && legacyTablesVisible
          ? 'tables'
          : parseDiffResultTab(parsed.resultTab),
      setupExpanded: DEFAULT_COMPARE_SETUP_EXPANDED,
      tableSearchQuery: parseStringPreference(parsed.tableSearchQuery, DEFAULT_TABLE_SEARCH_QUERY),
      endpointHistory: parseDiffEndpointHistory(parsed.endpointHistory)
    }
  } catch {
    return createDefaultDiffPanelPreferences()
  }
}

function createDefaultDiffPanelPreferences(): DiffPanelPreferences {
  return {
    statusFilter: DEFAULT_TABLE_STATUS_FILTER,
    tableCompareConcurrency: DEFAULT_TABLE_COMPARE_CONCURRENCY,
    resultTab: DEFAULT_DIFF_RESULT_TAB,
    setupExpanded: DEFAULT_COMPARE_SETUP_EXPANDED,
    tableSearchQuery: DEFAULT_TABLE_SEARCH_QUERY,
    endpointHistory: []
  }
}

export function createDiffEndpointHistoryKey(selection: DiffEndpointSelection): string {
  return [
    selection.sourceConnectionId,
    selection.sourceDatabase,
    selection.targetConnectionId,
    selection.targetDatabase
  ].join('\u001f')
}

export function hasCompleteDiffEndpointSelection(
  selection: DiffEndpointSelection
): boolean {
  return [
    selection.sourceConnectionId,
    selection.sourceDatabase,
    selection.targetConnectionId,
    selection.targetDatabase
  ].every((value) => value.trim().length > 0)
}

export function upsertDiffEndpointHistory(
  history: DiffEndpointHistoryItem[],
  selection: DiffEndpointSelection,
  updatedAt = Date.now()
): DiffEndpointHistoryItem[] {
  if (!hasCompleteDiffEndpointSelection(selection)) return history

  const nextItem: DiffEndpointHistoryItem = { ...selection, updatedAt }
  const nextKey = createDiffEndpointHistoryKey(nextItem)
  return [
    nextItem,
    ...history.filter((item) => createDiffEndpointHistoryKey(item) !== nextKey)
  ].slice(0, MAX_DIFF_ENDPOINT_HISTORY)
}

export function filterDiffEndpointHistoryByConnections(
  history: DiffEndpointHistoryItem[],
  connectionIds: ReadonlySet<string>
): DiffEndpointHistoryItem[] {
  return history.filter(
    (item) =>
      connectionIds.has(item.sourceConnectionId) && connectionIds.has(item.targetConnectionId)
  )
}

export function hasSchemaOrPresenceDiff(tableDiff: TableDiff): boolean {
  return (
    tableDiff.kind !== 'modified' ||
    tableDiff.columnDiffs.length > 0 ||
    tableDiff.indexDiffs.length > 0
  )
}

function hasChangedEntry(entry: TableCompareEntry): boolean {
  if (entry.status === 'error') return true
  return hasSchemaChangedEntry(entry) || hasRowChangedEntry(entry)
}

function hasSchemaChangedEntry(entry: TableCompareEntry): boolean {
  if (!entry.sourceExists || !entry.targetExists) return true
  return entry.tableDiff ? hasSchemaOrPresenceDiff(entry.tableDiff) : false
}

function hasRowChangedEntry(entry: TableCompareEntry): boolean {
  if (!entry.rowComparison?.dataDiff.comparable) return false
  return !hasNoRowDifferences(entry.rowComparison)
}

function parseTableStatusFilter(value: unknown): TableStatusFilter {
  return value === 'comparing' ||
    value === 'changed' ||
    value === 'schema-changed' ||
    value === 'row-changed'
    ? value
    : DEFAULT_TABLE_STATUS_FILTER
}

function parseDiffResultTab(value: unknown): DiffResultTab {
  return isDiffResultTab(value) ? value : DEFAULT_DIFF_RESULT_TAB
}

function isDiffResultTab(value: unknown): value is DiffResultTab {
  return value === 'tables' || value === 'status' || value === 'schema' || value === 'data'
}

function parseStringPreference(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function parseDiffEndpointHistory(value: unknown): DiffEndpointHistoryItem[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const history: DiffEndpointHistoryItem[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<Record<keyof DiffEndpointHistoryItem, unknown>>
    const parsedItem: DiffEndpointHistoryItem = {
      sourceConnectionId: parseStringPreference(candidate.sourceConnectionId, ''),
      sourceDatabase: parseStringPreference(candidate.sourceDatabase, ''),
      targetConnectionId: parseStringPreference(candidate.targetConnectionId, ''),
      targetDatabase: parseStringPreference(candidate.targetDatabase, ''),
      updatedAt: parseTimestamp(candidate.updatedAt)
    }

    if (!hasCompleteDiffEndpointSelection(parsedItem)) continue
    const key = createDiffEndpointHistoryKey(parsedItem)
    if (seen.has(key)) continue
    seen.add(key)
    history.push(parsedItem)
    if (history.length >= MAX_DIFF_ENDPOINT_HISTORY) break
  }
  return history
}

function parseTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
