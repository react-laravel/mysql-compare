import type { ColumnInfo } from '../../../shared/types'

/** 首次展示时格式化 JSON；编辑过程中保持用户输入的原始字符串，避免光标跳动。 */
export function formatJsonForDisplay(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value, null, 2)
  }

  const text = String(value)
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

export function formatInputValue(column: ColumnInfo, value: unknown): string {
  if (value === null || value === undefined) return ''
  if ((column.type === 'json' || column.type === 'jsonb')) {
    if (typeof value === 'string') return value
    return formatJsonForDisplay(value)
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

export function isJsonContentEqual(original: unknown, current: unknown): boolean {
  if (original === current) return true

  try {
    const parsedOriginal =
      typeof original === 'string' ? JSON.parse(original.trim()) : original
    const parsedCurrent = typeof current === 'string' ? JSON.parse(current.trim()) : current
    return JSON.stringify(parsedOriginal) === JSON.stringify(parsedCurrent)
  } catch {
    return String(original ?? '') === String(current ?? '')
  }
}

export function getFormattedJsonDisplay(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return formatJsonForDisplay(value)
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null

  try {
    JSON.parse(trimmed)
    return formatJsonForDisplay(trimmed)
  } catch {
    return null
  }
}

export function isRowEditValueEqual(
  column: ColumnInfo,
  original: unknown,
  current: unknown
): boolean {
  if (original === current) return true
  if (column.type !== 'json' && column.type !== 'jsonb') return false
  return isJsonContentEqual(original, current)
}

export function prepareRowEditValues(
  mode: 'insert' | 'edit',
  columns: ColumnInfo[],
  row?: Record<string, unknown>
): Record<string, unknown> {
  if (mode === 'edit' && row) {
    const values = { ...row }
    for (const column of columns) {
      if ((column.type === 'json' || column.type === 'jsonb') && values[column.name] != null) {
        values[column.name] = formatJsonForDisplay(values[column.name])
      }
    }
    return values
  }

  const init: Record<string, unknown> = {}
  for (const column of columns) {
    if (column.isAutoIncrement || column.isGenerated) continue
    init[column.name] = column.defaultValue ?? (column.nullable ? null : '')
  }
  return init
}
