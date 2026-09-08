import { describe, expect, it } from 'vitest'
import { buildAlignedCompareRows, buildRowDiffLookup } from './table-compare-diff'

describe('buildRowDiffLookup', () => {
  it.each([
    [' padded ', 'padded'],
    [null, 'null'],
    [1, '1'],
    [true, 'true'],
    ['2026-09-08T08:00:00+08:00', '2026-09-08T08:00:00Z'],
    ['2026-09-08 08:00:00.123001', '2026-09-08 08:00:00.123002']
  ])('preserves the difference between %j and %j', (left, right) => {
    const lookup = buildRowDiffLookup([{ id: 1, value: left }], [{ id: 1, value: right }], ['id'], ['value'])
    expect([...lookup!.source.values()][0]?.status).toBe('modified')
  })

  it('compares object content independently of property insertion order', () => {
    const lookup = buildRowDiffLookup([{ id: 1, value: { a: 1, b: null } }], [{ id: 1, value: { b: null, a: 1 } }], ['id'], ['value'])
    expect([...lookup!.source.values()][0]?.status).toBe('identical')
  })

  it('refuses duplicate or incomplete comparison keys instead of discarding rows', () => {
    expect(buildRowDiffLookup([{ id: 1 }, { id: 1 }], [], ['id'], ['id'])).toBeNull()
    expect(buildAlignedCompareRows([{ tenant: 1 }], [], ['tenant', 'id'])).toBeNull()
  })
  it('marks changed columns on modified rows', () => {
    const lookup = buildRowDiffLookup(
      [{ id: 1, name: 'Boar', level: 1 }],
      [{ id: 1, name: 'Boar', level: 2 }],
      ['id'],
      ['id', 'name', 'level']
    )

    expect(lookup?.source.get(JSON.stringify([{ column: 'id', value: 1 }]))).toEqual({
      status: 'modified',
      changedColumns: new Set(['level'])
    })
    expect(lookup?.target.get(JSON.stringify([{ column: 'id', value: 1 }]))?.changedColumns).toEqual(
      new Set(['level'])
    )
  })

  it('aligns rows by primary key with placeholders for missing side', () => {
    const aligned = buildAlignedCompareRows(
      [
        { id: 1, name: 'A' },
        { id: 3, name: 'C' }
      ],
      [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' }
      ],
      ['id']
    )

    expect(aligned).toHaveLength(3)
    expect(aligned?.[0]).toMatchObject({ sourceRow: { id: 1 }, targetRow: { id: 1 } })
    expect(aligned?.[1]).toMatchObject({ sourceRow: null, targetRow: { id: 2 } })
    expect(aligned?.[2]).toMatchObject({ sourceRow: { id: 3 }, targetRow: { id: 3 } })
  })

  it('marks source-only and target-only rows', () => {
    const lookup = buildRowDiffLookup(
      [{ id: 1, name: 'A' }],
      [{ id: 2, name: 'B' }],
      ['id'],
      ['id', 'name']
    )

    expect(lookup?.source.get(JSON.stringify([{ column: 'id', value: 1 }]))?.status).toBe(
      'source-only'
    )
    expect(lookup?.target.get(JSON.stringify([{ column: 'id', value: 2 }]))?.status).toBe(
      'target-only'
    )
  })
})
