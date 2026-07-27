import { beforeEach, describe, expect, it } from 'vitest'
import {
  restorePersistedUIState,
  useUIStore,
  type WorkspaceTab,
  type WorkspaceView
} from './ui-store'

function tableView(table: string, tableTab?: 'data' | 'structure' | 'info'): WorkspaceView {
  return { kind: 'table', connectionId: 'c1', database: 'shop', table, ...(tableTab ? { tableTab } : {}) }
}

function persisted(tabs: WorkspaceTab[], activeTabId: string | null) {
  return { workspaceTabs: tabs, activeTabId, rightView: { kind: 'empty' as const } }
}

function tab(view: WorkspaceView, id: string, title = id): WorkspaceTab {
  return { id, title, view }
}

describe('ui-store · setTableTab', () => {
  beforeEach(() => {
    useUIStore.setState({ workspaceTabs: [], activeTabId: null, rightView: { kind: 'empty' } })
  })

  it('stores the sub-tab on the tab view without changing tab identity', () => {
    const store = useUIStore.getState()
    store.setRightView(tableView('orders'))
    const tabId = useUIStore.getState().activeTabId!

    useUIStore.getState().setTableTab(tabId, 'structure')

    const next = useUIStore.getState()
    expect(next.workspaceTabs).toHaveLength(1)
    expect(next.activeTabId).toBe(tabId)
    expect(next.workspaceTabs[0]!.id).toBe(tabId)
    expect(next.workspaceTabs[0]!.view).toMatchObject({ kind: 'table', tableTab: 'structure' })
    expect(next.rightView).toMatchObject({ kind: 'table', tableTab: 'structure' })
  })

  it('leaves rightView alone when the tab is not the active one', () => {
    useUIStore.getState().setRightView(tableView('orders'))
    const ordersId = useUIStore.getState().activeTabId!
    useUIStore.getState().setRightView(tableView('users'))
    const usersId = useUIStore.getState().activeTabId!

    useUIStore.getState().setTableTab(ordersId, 'info')

    const next = useUIStore.getState()
    expect(next.activeTabId).toBe(usersId)
    expect(next.rightView).toMatchObject({ kind: 'table', table: 'users' })
    expect(next.workspaceTabs.find((item) => item.id === ordersId)!.view).toMatchObject({
      tableTab: 'info'
    })
  })

  it('ignores unknown tabs and non-table tabs', () => {
    useUIStore.getState().setRightView({ kind: 'diff' })
    const before = useUIStore.getState().workspaceTabs

    useUIStore.getState().setTableTab('diff', 'info')
    useUIStore.getState().setTableTab('nope', 'info')

    expect(useUIStore.getState().workspaceTabs).toBe(before)
  })

  it('keeps the sub-tab when the same table is re-selected from the tree', () => {
    useUIStore.getState().setRightView(tableView('orders'))
    const tabId = useUIStore.getState().activeTabId!
    useUIStore.getState().setTableTab(tabId, 'structure')

    useUIStore.getState().setRightView(tableView('users'))
    useUIStore.getState().setRightView(tableView('orders'))

    expect(useUIStore.getState().rightView).toMatchObject({ table: 'orders', tableTab: 'structure' })
  })

  it('lets an explicit tableTab override what the tab was left on', () => {
    useUIStore.getState().setRightView(tableView('orders'))
    const tabId = useUIStore.getState().activeTabId!
    useUIStore.getState().setTableTab(tabId, 'structure')

    useUIStore.getState().setRightView(tableView('orders', 'info'))

    expect(useUIStore.getState().rightView).toMatchObject({ tableTab: 'info' })
  })

  it('survives a rename, because the sub-tab rides on the view', () => {
    useUIStore.getState().setRightView(tableView('orders'))
    const tabId = useUIStore.getState().activeTabId!
    useUIStore.getState().setTableTab(tabId, 'info')

    useUIStore.getState().renameTableTabs('c1', 'shop', 'orders', 'orders_v2')

    const renamed = useUIStore.getState().workspaceTabs[0]!
    expect(renamed.id).toBe('table:c1:shop:orders_v2')
    expect(renamed.view).toMatchObject({ table: 'orders_v2', tableTab: 'info' })
  })
})

describe('ui-store · restorePersistedUIState', () => {
  it('returns the empty workspace for junk', () => {
    expect(restorePersistedUIState(null)).toEqual({
      workspaceTabs: [],
      activeTabId: null,
      rightView: { kind: 'empty' }
    })
    expect(restorePersistedUIState({ workspaceTabs: 'nope' }).workspaceTabs).toEqual([])
  })

  it('drops volatile tabs (live PTY / one-shot export) and keeps the rest', () => {
    const restored = restorePersistedUIState(
      persisted(
        [
          tab(tableView('orders', 'structure'), 'table:c1:shop:orders'),
          tab({ kind: 'ssh-terminal', connectionId: 'c1', connectionName: 'prod' }, 'ssh-terminal:c1'),
          tab(
            {
              kind: 'database-export',
              exportTaskId: 'task-1',
              request: { connectionId: 'c1', database: 'shop' } as never
            },
            'database-export:task-1'
          ),
          tab({ kind: 'ssh-editor', connectionId: 'c1', connectionName: 'prod', path: '/etc/hosts' }, 'ssh-editor:c1:/etc/hosts')
        ],
        'table:c1:shop:orders'
      )
    )

    expect(restored.workspaceTabs.map((item) => item.view.kind)).toEqual(['table', 'ssh-editor'])
    expect(restored.activeTabId).toBe('table:c1:shop:orders')
    expect(restored.rightView).toMatchObject({ kind: 'table', tableTab: 'structure' })
  })

  it('drops malformed views and de-duplicates ids', () => {
    const restored = restorePersistedUIState(
      persisted(
        [
          tab(tableView('orders'), 'table:c1:shop:orders'),
          tab(tableView('orders'), 'stale-duplicate-id'),
          { id: 'x', title: 'x', view: { kind: 'table', connectionId: 'c1' } as never },
          { id: 'y', title: 'y', view: { kind: 'made-up' } as never }
        ],
        'table:c1:shop:orders'
      )
    )

    expect(restored.workspaceTabs).toHaveLength(1)
  })

  it('recomputes the active tab when the persisted one did not survive', () => {
    const restored = restorePersistedUIState(
      persisted([tab(tableView('orders'), 'table:c1:shop:orders')], 'ssh-terminal:c1')
    )

    expect(restored.activeTabId).toBe('table:c1:shop:orders')
    expect(restored.rightView).toMatchObject({ kind: 'table', table: 'orders' })
  })

  it('keeps the empty right view when nothing was active', () => {
    const restored = restorePersistedUIState(
      persisted([tab(tableView('orders'), 'table:c1:shop:orders')], null)
    )

    expect(restored.workspaceTabs).toHaveLength(1)
    expect(restored.activeTabId).toBeNull()
    expect(restored.rightView).toEqual({ kind: 'empty' })
  })

  it('restores a table-compare tab only with its full descriptor', () => {
    const complete: WorkspaceView = {
      kind: 'table-compare',
      compareSessionId: 's1',
      sourceConnectionId: 'c1',
      sourceDatabase: 'shop',
      targetConnectionId: 'c2',
      targetDatabase: 'shop_staging',
      table: 'orders',
      comparedTables: ['orders'],
      diffTables: ['orders']
    }
    const { comparedTables: _dropped, ...incomplete } = complete as never as Record<string, unknown>

    const restored = restorePersistedUIState(
      persisted(
        [
          tab(complete, 'table-compare:s1'),
          { id: 'table-compare:s2', title: 's2', view: incomplete as never }
        ],
        'table-compare:s1'
      )
    )

    expect(restored.workspaceTabs).toHaveLength(1)
    expect(restored.workspaceTabs[0]!.id).toBe('table-compare:s1')
  })
})
