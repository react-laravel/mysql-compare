import { describe, expect, it } from 'vitest'
import type { Translator } from '@renderer/i18n'
import {
  normalizeResult,
  serializeRows,
  splitErrorMessage,
  type SQLExecutionResult
} from './sql-result-normalize'

const t: Translator = (key, vars) =>
  vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')})` : key

describe('normalizeResult', () => {
  it('reports an empty array as a successful statement', () => {
    expect(normalizeResult([], t)).toEqual<SQLExecutionResult>({
      kind: 'empty',
      message: 'sql.statementSuccess'
    })
  })

  it('unions the column names across rows', () => {
    const result = normalizeResult([{ id: 1 }, { id: 2, name: 'a' }], t)
    expect(result).toMatchObject({ kind: 'rows', columns: ['id', 'name'] })
  })

  it('folds a list of mutation payloads into a batch summary', () => {
    const result = normalizeResult(
      [
        { affectedRows: 2, insertId: 0 },
        { affectedRows: 3, insertId: 7 }
      ],
      t
    )
    expect(result).toMatchObject({ kind: 'batch', statements: 2, affectedRows: 5 })
    expect((result as { details: string[] }).details[1]).toContain('id=7')
  })

  it('takes the first result set when the driver returns nested arrays', () => {
    const result = normalizeResult([[{ a: 1 }], [{ b: 2 }]], t)
    expect(result).toEqual<SQLExecutionResult>({ kind: 'rows', columns: ['a'], rows: [{ a: 1 }] })
  })

  it('treats a rows envelope with no rows as empty', () => {
    expect(normalizeResult({ rows: [] }, t)).toMatchObject({ kind: 'empty' })
  })

  it('reads a mutation envelope', () => {
    expect(normalizeResult({ affectedRows: 4, insertId: 9, warningStatus: 1 }, t)).toEqual({
      kind: 'mutation',
      affectedRows: 4,
      insertId: 9,
      warningStatus: 1
    })
  })

  it('falls back to empty for an unrecognised payload', () => {
    expect(normalizeResult(null, t)).toMatchObject({ kind: 'empty' })
    expect(normalizeResult(42, t)).toMatchObject({ kind: 'empty' })
  })
})

describe('serializeRows', () => {
  const columns = ['id', 'name']
  const rows = [{ id: 1, name: 'a\tb' }, { id: 2, name: null }]

  it('writes a header row and flattens tabs inside values', () => {
    expect(serializeRows(columns, rows, 'tsv')).toBe('id\tname\n1\ta b\n2\t')
  })

  it('writes indented JSON', () => {
    expect(JSON.parse(serializeRows(columns, rows, 'json'))).toEqual(rows)
  })
})

describe('splitErrorMessage', () => {
  it('keeps a short single-line message whole', () => {
    expect(splitErrorMessage('  ER_PARSE_ERROR  ')).toEqual({
      headline: 'ER_PARSE_ERROR',
      detail: null
    })
  })

  it('hides everything after the first line behind details', () => {
    const { headline, detail } = splitErrorMessage('ER_NO_SUCH_TABLE\n  at driver\n  at pool')
    expect(headline).toBe('ER_NO_SUCH_TABLE')
    expect(detail).toContain('at pool')
  })

  it('truncates a very long single-line message but keeps the full text', () => {
    const message = 'x'.repeat(500)
    const { headline, detail } = splitErrorMessage(message)
    expect(headline).toHaveLength(241)
    expect(detail).toBe(message)
  })
})
