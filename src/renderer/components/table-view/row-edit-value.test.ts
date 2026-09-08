import { describe, expect, it } from 'vitest'
import type { ColumnInfo } from '../../../shared/types'
import { normalizeColumnValue } from './RowEditDialog'

const column = (type: string): ColumnInfo => ({ name: 'value', type, nullable: true, defaultValue: null, isPrimaryKey: false, isAutoIncrement: false, comment: '', columnKey: '' })
describe('row editor value preservation', () => {
  it('keeps large integers and exact decimals as strings through submission', () => {
    expect(normalizeColumnValue(column('bigint'), '9007199254740993', 'edit', (key) => key)).toBe('9007199254740993')
    expect(normalizeColumnValue(column('numeric(30,10)'), '12345678901234567890.1234567890', 'edit', (key) => key)).toBe('12345678901234567890.1234567890')
    expect(normalizeColumnValue(column('int'), '42', 'edit', (key) => key)).toBe(42)
  })
  it('preserves whitespace and distinguishes empty text from NULL', () => {
    expect(normalizeColumnValue(column('text'), ' spaced ', 'edit', (key) => key)).toBe(' spaced ')
    expect(normalizeColumnValue(column('text'), '', 'edit', (key) => key)).toBe('')
    expect(normalizeColumnValue(column('text'), null, 'edit', (key) => key)).toBeNull()
  })
  it('rejects fractional integer input before sending it to the driver', () => {
    expect(() => normalizeColumnValue(column('bigint'), '1.5', 'edit', (key) => key)).toThrow()
  })
})
