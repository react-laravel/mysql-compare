import { describe, expect, it, vi } from 'vitest'
import type { QueryRowsResult } from '../../../shared/types'
import { completeComparisonPage, sharedComparisonKey } from './table-compare-page'
import { buildRowDiffLookup } from './table-compare-diff'

const result = (ids: number[], total: number): QueryRowsResult => ({ rows: ids.map((id) => ({ id })), total, primaryKey: ['id'], hasPrimaryKey: true, columns: [] })
const sourceEndpoint = { connectionId: 's', database: 'app', table: 'items' }
const targetEndpoint = { ...sourceEndpoint, connectionId: 't' }

describe('comparison page completion', () => {
  it('finds a matching row beyond the peer page before marking it as absent', async () => {
    const query = vi.fn().mockResolvedValue(result([3], 1))
    const [source, target] = await completeComparisonPage(result([1, 2], 3), result([2, 3], 2), sourceEndpoint, targetEndpoint, query)
    expect(query).toHaveBeenCalledExactlyOnceWith({ ...sourceEndpoint, page: 1, pageSize: 1000, keyRows: [{ id: 3 }] })
    const diff = buildRowDiffLookup(source.rows, target.rows, ['id'], ['id'])!
    expect([...diff.target.values()].map((row) => row.status)).toEqual(['identical', 'identical'])
    expect([...diff.source.values()].filter((row) => row.status === 'source-only')).toHaveLength(1)
  })

  it('does not pair rows using only part of a composite primary key', () => {
    expect(sharedComparisonKey({ ...result([], 0), primaryKey: ['tenant', 'id'] }, result([], 0))).toEqual([])
  })

  it('propagates lookup failure rather than displaying a false missing row', async () => {
    await expect(completeComparisonPage(result([1], 10), result([2], 10), sourceEndpoint, targetEndpoint, vi.fn().mockRejectedValue(new Error('offline')))).rejects.toThrow('offline')
  })
})
