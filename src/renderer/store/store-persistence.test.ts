// @vitest-environment jsdom

// The persisted stores rehydrate at module evaluation, so every case seeds
// localStorage first and then imports the module fresh.
import { beforeEach, describe, expect, it, vi } from 'vitest'

function seed(key: string, state: unknown, version = 1): void {
  window.localStorage.setItem(key, JSON.stringify({ state, version }))
}

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-colorblind-diff')
  vi.resetModules()
})

describe('ui-store persistence', () => {
  it('restores open tabs and drops the volatile ones', async () => {
    seed('mysql-compare:workspace', {
      workspaceTabs: [
        {
          id: 'table:c1:shop:orders',
          title: 'shop / orders',
          view: { kind: 'table', connectionId: 'c1', database: 'shop', table: 'orders', tableTab: 'info' }
        },
        {
          id: 'ssh-terminal:c1',
          title: 'Terminal · prod',
          view: { kind: 'ssh-terminal', connectionId: 'c1', connectionName: 'prod' }
        }
      ],
      activeTabId: 'ssh-terminal:c1',
      rightView: { kind: 'ssh-terminal', connectionId: 'c1', connectionName: 'prod' }
    })

    const { useUIStore } = await import('./ui-store')
    const state = useUIStore.getState()

    expect(state.workspaceTabs.map((tab) => tab.id)).toEqual(['table:c1:shop:orders'])
    expect(state.activeTabId).toBe('table:c1:shop:orders')
    expect(state.rightView).toMatchObject({ kind: 'table', tableTab: 'info' })
  })

  it('writes the workspace back out when a tab opens', async () => {
    const { useUIStore } = await import('./ui-store')
    useUIStore.getState().setRightView({ kind: 'diff' })

    const raw = window.localStorage.getItem('mysql-compare:workspace')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as { state: { workspaceTabs: { id: string }[] } }
    expect(parsed.state.workspaceTabs.map((tab) => tab.id)).toEqual(['diff'])
  })

  it('keeps a restored table tab but drops an unknown sub-tab', async () => {
    seed('mysql-compare:workspace', {
      workspaceTabs: [
        {
          id: 'table:c1:shop:orders',
          title: 'shop / orders',
          view: { kind: 'table', connectionId: 'c1', database: 'shop', table: 'orders', tableTab: 'bogus' }
        }
      ],
      activeTabId: 'table:c1:shop:orders',
      rightView: { kind: 'empty' }
    })

    const { useUIStore } = await import('./ui-store')
    const [tab] = useUIStore.getState().workspaceTabs

    expect(tab?.id).toBe('table:c1:shop:orders')
    expect(tab?.view).not.toHaveProperty('tableTab')
  })

  it('starts empty when the stored payload is garbage', async () => {
    window.localStorage.setItem('mysql-compare:workspace', '{"state":{"workspaceTabs":42},"version":1}')

    const { useUIStore } = await import('./ui-store')
    expect(useUIStore.getState().workspaceTabs).toEqual([])
    expect(useUIStore.getState().rightView).toEqual({ kind: 'empty' })
  })
})

describe('sidebar-store persistence', () => {
  it('adopts the pre-store sidebar width key', async () => {
    window.localStorage.setItem('mysql-compare:sidebar-width', '412')

    const { useSidebarStore } = await import('./sidebar-store')
    expect(useSidebarStore.getState().width).toBe(412)
  })

  it('prefers its own persisted width and clamps it', async () => {
    window.localStorage.setItem('mysql-compare:sidebar-width', '412')
    seed('mysql-compare:sidebar', { width: 9000, collapsed: true })

    const { MAX_SIDEBAR_WIDTH, useSidebarStore } = await import('./sidebar-store')
    expect(useSidebarStore.getState().width).toBe(MAX_SIDEBAR_WIDTH)
    expect(useSidebarStore.getState().collapsed).toBe(true)
  })

  it('persists width and collapsed only', async () => {
    const { useSidebarStore } = await import('./sidebar-store')
    useSidebarStore.getState().setKeyword('shop')
    useSidebarStore.getState().toggleCollapsed()

    const parsed = JSON.parse(window.localStorage.getItem('mysql-compare:sidebar')!) as {
      state: Record<string, unknown>
    }
    expect(Object.keys(parsed.state).sort()).toEqual(['collapsed', 'width'])
    expect(parsed.state.collapsed).toBe(true)
  })
})

describe('settings-store persistence', () => {
  it('applies the colorblind diff attribute on rehydrate', async () => {
    seed('mysql-compare:settings', { colorblindDiff: true })

    const { useSettingsStore } = await import('./settings-store')
    expect(useSettingsStore.getState().colorblindDiff).toBe(true)
    expect(document.documentElement.getAttribute('data-colorblind-diff')).toBe('true')
  })

  it('toggles the attribute with the flag', async () => {
    const { useSettingsStore, initializeSettings } = await import('./settings-store')

    initializeSettings()
    expect(document.documentElement.hasAttribute('data-colorblind-diff')).toBe(false)

    useSettingsStore.getState().setColorblindDiff(true)
    expect(document.documentElement.getAttribute('data-colorblind-diff')).toBe('true')

    useSettingsStore.getState().reset()
    expect(document.documentElement.hasAttribute('data-colorblind-diff')).toBe(false)
  })

  it('keeps defaults for values it has never been told about', async () => {
    seed('mysql-compare:settings', { density: 'comfortable' })

    const { useSettingsStore, DEFAULT_PAGE_SIZE } = await import('./settings-store')
    expect(useSettingsStore.getState().density).toBe('comfortable')
    expect(useSettingsStore.getState().defaultPageSize).toBe(DEFAULT_PAGE_SIZE)
  })

  // `defaultPageSize` is handed straight to `db.queryRows({ pageSize })`, so an
  // out-of-range or wrongly typed value would break every table tab.
  it('falls back to defaults for values outside their domain', async () => {
    seed('mysql-compare:settings', {
      density: 'roomy',
      colorblindDiff: 'yes',
      defaultPageSize: 'abc',
      wrapCells: 1,
      compareRows: null,
      tableCompareConcurrency: 0
    })

    const { useSettingsStore, DEFAULT_PAGE_SIZE, DEFAULT_TABLE_COMPARE_CONCURRENCY } =
      await import('./settings-store')
    const state = useSettingsStore.getState()

    expect(state.density).toBe('compact')
    expect(state.colorblindDiff).toBe(false)
    expect(state.defaultPageSize).toBe(DEFAULT_PAGE_SIZE)
    expect(state.wrapCells).toBe(false)
    // Chunk 9: the diff panel's "Compare rows" toggle reads this store, and it
    // shipped on by default — so the fallback is `true`, not `false`.
    expect(state.compareRows).toBe(true)
    expect(state.tableCompareConcurrency).toBe(DEFAULT_TABLE_COMPARE_CONCURRENCY)
    expect(document.documentElement.hasAttribute('data-colorblind-diff')).toBe(false)
  })

})
