// The SQL console's pure layer: turning whatever the driver returned into one
// of five renderable shapes, plus the two clipboard serialisers.
//
// Split out of `SQLQueryView.tsx` (blueprint §5, chunk 8) so the branchy driver
// normalisation is testable without mounting Monaco.
import { formatCellValue } from '@renderer/lib/utils'
import type { Translator } from '@renderer/i18n'
import type { ExplainSQLResult } from '../../../shared/types'

export type SQLExecutionResult =
  | { kind: 'rows'; columns: string[]; rows: Record<string, unknown>[] }
  | { kind: 'mutation'; affectedRows: number; insertId?: number | string; warningStatus?: number }
  | { kind: 'batch'; statements: number; affectedRows: number; details: string[] }
  | { kind: 'explain'; result: ExplainSQLResult }
  | { kind: 'empty'; message: string }

export type CopyFormat = 'tsv' | 'json'

export function normalizeResult(raw: unknown, t: Translator): SQLExecutionResult {
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      return { kind: 'empty', message: t('sql.statementSuccess') }
    }

    if (raw.every((item) => isMutationPayload(item))) {
      const results = raw as Array<Record<string, unknown>>
      return {
        kind: 'batch',
        statements: results.length,
        affectedRows: results.reduce((sum, item) => sum + Number(item.affectedRows ?? 0), 0),
        details: results.map((item, index) => {
          const affectedRows = Number(item.affectedRows ?? 0)
          const insertId = item.insertId
          return insertId !== undefined && insertId !== 0
            ? t('sql.statementDetailWithInsertId', {
                index: index + 1,
                count: affectedRows,
                id: String(insertId)
              })
            : t('sql.statementDetail', { index: index + 1, count: affectedRows })
        })
      }
    }

    if (raw.every((item) => Array.isArray(item))) {
      const firstResultSet = (raw[0] ?? []) as Record<string, unknown>[]
      return { kind: 'rows', columns: collectColumns(firstResultSet), rows: firstResultSet }
    }

    const rows = raw as Record<string, unknown>[]
    return { kind: 'rows', columns: collectColumns(rows), rows }
  }

  if (raw && typeof raw === 'object') {
    const payload = raw as Record<string, unknown>
    if (Array.isArray(payload.rows)) {
      const rows = payload.rows as Record<string, unknown>[]
      return rows.length > 0
        ? { kind: 'rows', columns: collectColumns(rows), rows }
        : { kind: 'empty', message: t('sql.statementSuccess') }
    }
    if (typeof payload.affectedRows === 'number') {
      return {
        kind: 'mutation',
        affectedRows: payload.affectedRows,
        insertId: payload.insertId as number | string | undefined,
        warningStatus: payload.warningStatus as number | undefined
      }
    }
  }

  return { kind: 'empty', message: t('sql.statementSuccess') }
}

export function isMutationPayload(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).affectedRows === 'number'
  )
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
  return Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
}

/** The clipboard payload behind "Copy results as TSV / JSON". */
export function serializeRows(
  columns: string[],
  rows: Record<string, unknown>[],
  format: CopyFormat
): string {
  if (format === 'json') return JSON.stringify(rows, null, 2)
  return [
    columns.join('\t'),
    ...rows.map((row) =>
      columns.map((column) => formatCellValue(row[column]).replace(/\t/g, ' ')).join('\t')
    )
  ].join('\n')
}

/**
 * A driver error is usually "one readable sentence" + a stack of connection
 * detail. The console shows the sentence and hides the rest behind `<details>`
 * rather than dumping the whole thing in a red box.
 */
export function splitErrorMessage(message: string): { headline: string; detail: string | null } {
  const trimmed = message.trim()
  const newline = trimmed.indexOf('\n')
  if (newline < 0) {
    return trimmed.length > 240
      ? { headline: `${trimmed.slice(0, 240)}…`, detail: trimmed }
      : { headline: trimmed, detail: null }
  }
  return { headline: trimmed.slice(0, newline).trim(), detail: trimmed }
}
