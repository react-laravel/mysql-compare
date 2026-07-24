import { describe, expect, it } from 'vitest'
import { orderTablesByForeignKeys } from './fk-order'

describe('orderTablesByForeignKeys', () => {
  it('returns the original order when there are no edges', () => {
    expect(orderTablesByForeignKeys(['b', 'a'], [])).toEqual(['b', 'a'])
  })

  it('orders parents before dependents', () => {
    expect(
      orderTablesByForeignKeys(['orders', 'users', 'order_items'], [
        { fromTable: 'orders', toTable: 'users' },
        { fromTable: 'order_items', toTable: 'orders' }
      ])
    ).toEqual(['users', 'orders', 'order_items'])
  })

  it('ignores edges outside the selected table set', () => {
    expect(
      orderTablesByForeignKeys(['orders', 'users'], [
        { fromTable: 'orders', toTable: 'users' },
        { fromTable: 'payments', toTable: 'orders' }
      ])
    ).toEqual(['users', 'orders'])
  })

  it('keeps a stable fallback when a cycle exists', () => {
    expect(
      orderTablesByForeignKeys(['a', 'b', 'c'], [
        { fromTable: 'a', toTable: 'b' },
        { fromTable: 'b', toTable: 'a' }
      ])
    ).toEqual(['c', 'a', 'b'])
  })
})
