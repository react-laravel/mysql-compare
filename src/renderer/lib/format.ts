/**
 * Shared value formatters. These existed as three copies of `formatBytes`
 * (DatabaseInfoView, TableInfoView, SSHFileManager) and two of `formatNumber`,
 * which disagreed on rounding.
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** 0 B · 512 B · 4.20 MB · 12 GB — two decimals under 10, none at or above. */
export function formatBytes(value?: number | null, fractionDigits = 2): string {
  const bytes = Math.max(0, value ?? 0)
  if (!Number.isFinite(bytes) || bytes === 0) return '0 B'

  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  const digits = size >= 10 || unitIndex === 0 ? 0 : fractionDigits
  return `${size.toFixed(digits)} ${BYTE_UNITS[unitIndex]}`
}

/** Locale-grouped integer; `-` when the backend did not report the value. */
export function formatNumber(value?: number | null, fallback = '-'): string {
  if (value == null || !Number.isFinite(value)) return fallback
  return value.toLocaleString()
}

/** Short absolute timestamp for file listings and job logs. */
export function formatDateTime(value?: number | null, fallback = '—'): string {
  if (!value) return fallback
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}
