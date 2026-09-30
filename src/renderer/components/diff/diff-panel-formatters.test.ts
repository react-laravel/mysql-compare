import { expect, it, vi } from 'vitest'
import { tableKey } from '../../../shared/table-reference'
import { formatComparePhase } from './diff-panel-formatters'

it('formats a pending scoped table using the visible schema and table name', () => {
  const t = vi.fn(() => 'Comparing')
  formatComparePhase('comparing', 1, 3, tableKey('sales.v2', 'users'), t)
  expect(t).toHaveBeenCalledWith('diff.phase.comparingPending', {
    done: 1, total: 3, pending: 'sales.v2.users'
  })
})
