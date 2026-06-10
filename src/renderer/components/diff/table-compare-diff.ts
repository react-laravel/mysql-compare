import { buildRowKey } from './table-compare-utils'

export type RowDiffStatus = 'identical' | 'modified' | 'source-only' | 'target-only'

export interface RowDiffInfo {
  status: RowDiffStatus
  changedColumns: Set<string>
}

export interface RowDiffLookup {
  source: Map<string, RowDiffInfo>
  target: Map<string, RowDiffInfo>
}

export interface AlignedCompareRow {
  key: string
  sourceRow: Record<string, unknown> | null
  targetRow: Record<string, unknown> | null
}

export function buildAlignedCompareRows(
  sourceRows: Record<string, unknown>[],
  targetRows: Record<string, unknown>[],
  keyColumns: string[]
): AlignedCompareRow[] | null {
  if (keyColumns.length === 0) return null

  const sourceByKey = indexRowsByKey(sourceRows, keyColumns)
  const targetByKey = indexRowsByKey(targetRows, keyColumns)
  const keys = [...new Set([...sourceByKey.keys(), ...targetByKey.keys()])].sort(compareRowKeys)

  return keys.map((key) => ({
    key,
    sourceRow: sourceByKey.get(key) ?? null,
    targetRow: targetByKey.get(key) ?? null
  }))
}

export function syncComparePaneScroll(activeElement: HTMLElement, peerElement: HTMLElement): void {
  const activeMaxScroll = Math.max(0, activeElement.scrollHeight - activeElement.clientHeight)
  const peerMaxScroll = Math.max(0, peerElement.scrollHeight - peerElement.clientHeight)
  const scrollRatio = activeMaxScroll > 0 ? activeElement.scrollTop / activeMaxScroll : 0

  peerElement.scrollTop = scrollRatio * peerMaxScroll
  peerElement.scrollLeft = activeElement.scrollLeft
}

export function buildRowDiffLookup(
  sourceRows: Record<string, unknown>[],
  targetRows: Record<string, unknown>[],
  keyColumns: string[],
  compareColumnNames: string[]
): RowDiffLookup | null {
  if (keyColumns.length === 0) return null

  const sourceByKey = indexRowsByKey(sourceRows, keyColumns)
  const targetByKey = indexRowsByKey(targetRows, keyColumns)
  const source = new Map<string, RowDiffInfo>()
  const target = new Map<string, RowDiffInfo>()

  for (const [key, sourceRow] of sourceByKey) {
    const targetRow = targetByKey.get(key)
    if (!targetRow) {
      source.set(key, { status: 'source-only', changedColumns: new Set() })
      continue
    }

    const changedColumns = getChangedColumns(sourceRow, targetRow, compareColumnNames)
    source.set(key, {
      status: changedColumns.size > 0 ? 'modified' : 'identical',
      changedColumns
    })
  }

  for (const [key, targetRow] of targetByKey) {
    const sourceRow = sourceByKey.get(key)
    if (!sourceRow) {
      target.set(key, { status: 'target-only', changedColumns: new Set() })
      continue
    }

    const changedColumns = getChangedColumns(sourceRow, targetRow, compareColumnNames)
    target.set(key, {
      status: changedColumns.size > 0 ? 'modified' : 'identical',
      changedColumns
    })
  }

  return { source, target }
}

function indexRowsByKey(
  rows: Record<string, unknown>[],
  keyColumns: string[]
): Map<string, Record<string, unknown>> {
  const indexed = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const key = buildRowKey(row, keyColumns)
    if (key) indexed.set(key, row)
  }
  return indexed
}

function getChangedColumns(
  sourceRow: Record<string, unknown>,
  targetRow: Record<string, unknown>,
  columnNames: string[]
): Set<string> {
  const changed = new Set<string>()

  for (const column of columnNames) {
    if (!areComparableValuesEqual(sourceRow[column], targetRow[column])) {
      changed.add(column)
    }
  }

  return changed
}

function areComparableValuesEqual(source: unknown, target: unknown): boolean {
  return (
    serializeComparableValue(normalizeComparableValue(source)) ===
    serializeComparableValue(normalizeComparableValue(target))
  )
}

function normalizeComparableValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return normalizeTemporalString(value)
  if (value instanceof Date) return formatDateTime(value)
  if (Array.isArray(value)) return value.map((item) => normalizeComparableValue(item))
  if (typeof value === 'object') return sortObjectKeys(value as Record<string, unknown>)
  return String(value)
}

function normalizeTemporalString(value: string): string {
  const trimmed = value.trim()
  const dateOnlyMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/)
  if (dateOnlyMatch) return dateOnlyMatch[1]!

  const dateTimeMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(?:Z|[+-]\d{2}:?\d{2})?$/
  )
  if (!dateTimeMatch) return trimmed

  const milliseconds = dateTimeMatch[3] ? `.${dateTimeMatch[3]!.slice(0, 3)}` : ''
  return `${dateTimeMatch[1]!} ${dateTimeMatch[2]!}${milliseconds}`
}

function formatDateTime(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  const hour = String(value.getHours()).padStart(2, '0')
  const minute = String(value.getMinutes()).padStart(2, '0')
  const second = String(value.getSeconds()).padStart(2, '0')
  const millisecond = value.getMilliseconds()
  const fraction = millisecond > 0 ? `.${String(millisecond).padStart(3, '0')}` : ''
  return `${year}-${month}-${day} ${hour}:${minute}:${second}${fraction}`
}

function sortObjectKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, normalizeComparableValue(entryValue)])
  )
}

function serializeComparableValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function compareRowKeys(leftKey: string, rightKey: string): number {
  const leftParts = extractRowKeyParts(leftKey)
  const rightParts = extractRowKeyParts(rightKey)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const compared = compareComparableValues(leftParts[index] ?? null, rightParts[index] ?? null)
    if (compared !== 0) return compared
  }

  return 0
}

function extractRowKeyParts(key: string): unknown[] {
  try {
    const parsed = JSON.parse(key) as Array<{ column: string; value: unknown }>
    return parsed.map((entry) => entry.value)
  } catch {
    return []
  }
}

function compareComparableValues(source: unknown, target: unknown): number {
  if (source === target) return 0
  if (source === null || source === undefined) return -1
  if (target === null || target === undefined) return 1

  const sourceType = comparableTypeRank(source)
  const targetType = comparableTypeRank(target)
  if (sourceType !== targetType) {
    return sourceType < targetType ? -1 : 1
  }

  if (typeof source === 'number' && typeof target === 'number') {
    return source < target ? -1 : 1
  }

  if (typeof source === 'boolean' && typeof target === 'boolean') {
    return source ? 1 : -1
  }

  const sourceText = serializeComparableValue(normalizeComparableValue(source))
  const targetText = serializeComparableValue(normalizeComparableValue(target))
  if (sourceText === targetText) return 0
  return sourceText < targetText ? -1 : 1
}

function comparableTypeRank(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return 1
  if (typeof value === 'boolean') return 2
  if (typeof value === 'string') return 3
  return 4
}
