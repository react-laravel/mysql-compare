// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { DIFF_PANEL_PREFERENCES_KEY } from '@renderer/components/diff/diff-panel-utils'
import { SIDEBAR_STORAGE_KEY } from '@renderer/store/sidebar-store'
import {
  HIDDEN_COLUMNS_KEY_PREFIX,
  SCROLL_POSITION_KEY_PREFIX,
  SQL_EDITOR_SIZE_KEY,
  SQL_HISTORY_KEY_PREFIX,
  clearDiffEndpointHistory,
  clearHiddenColumns,
  clearSQLHistory,
  resetLayout
} from './storage-maintenance'

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('clearSQLHistory', () => {
  it('removes every per-database history and nothing else', () => {
    window.localStorage.setItem(`${SQL_HISTORY_KEY_PREFIX}c1:shop`, '["select 1"]')
    window.localStorage.setItem(`${SQL_HISTORY_KEY_PREFIX}c1:blog`, '["select 2"]')
    window.localStorage.setItem('mysql-compare:theme', 'dark')

    expect(clearSQLHistory()).toBe(2)
    expect(window.localStorage.getItem('mysql-compare:theme')).toBe('dark')
    expect(window.localStorage.length).toBe(1)
  })
})

describe('clearDiffEndpointHistory', () => {
  it('drops the pairs but keeps the rest of the diff preferences', () => {
    window.localStorage.setItem(
      DIFF_PANEL_PREFERENCES_KEY,
      JSON.stringify({
        statusFilter: 'changed',
        tableCompareConcurrency: 20,
        resultTab: 'schema',
        endpointHistory: [
          {
            sourceConnectionId: 'a',
            sourceDatabase: 'shop',
            targetConnectionId: 'b',
            targetDatabase: 'shop',
            updatedAt: 1
          }
        ]
      })
    )

    expect(clearDiffEndpointHistory()).toBe(1)

    const stored = JSON.parse(window.localStorage.getItem(DIFF_PANEL_PREFERENCES_KEY) ?? '{}')
    expect(stored.endpointHistory).toEqual([])
    expect(stored.statusFilter).toBe('changed')
    expect(stored.tableCompareConcurrency).toBe(20)
  })

  it('is a no-op when the panel never stored anything', () => {
    expect(clearDiffEndpointHistory()).toBe(0)
  })
})

describe('clearHiddenColumns', () => {
  it('resets every per-table column layout', () => {
    window.localStorage.setItem(`${HIDDEN_COLUMNS_KEY_PREFIX}:c1:shop:orders`, '["id"]')
    window.localStorage.setItem(`${HIDDEN_COLUMNS_KEY_PREFIX}:c1:shop:users`, '["id"]')

    expect(clearHiddenColumns()).toBe(2)
    expect(window.localStorage.length).toBe(0)
  })
})

describe('resetLayout', () => {
  it('clears chrome geometry and scroll positions but keeps open tabs', () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, '{"state":{"width":400}}')
    window.localStorage.setItem(SQL_EDITOR_SIZE_KEY, '42')
    window.localStorage.setItem('mysql-compare:workspace', '{"state":{"workspaceTabs":[]}}')
    window.sessionStorage.setItem(`${SCROLL_POSITION_KEY_PREFIX}tree`, '120')

    expect(resetLayout()).toBe(3)
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem('mysql-compare:workspace')).not.toBeNull()
    expect(window.sessionStorage.length).toBe(0)
  })
})
