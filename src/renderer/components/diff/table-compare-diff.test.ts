import { describe, expect, it } from 'vitest'
import { buildAlignedCompareRows, buildRowDiffLookup } from './table-compare-diff'

describe('buildRowDiffLookup', () => {
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
