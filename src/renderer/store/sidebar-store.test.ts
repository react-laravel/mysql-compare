import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  useSidebarStore
} from './sidebar-store'
import type { NodeState } from '@renderer/components/layout/sidebar-types'

function node(overrides: Partial<NodeState> = {}): NodeState {
  return { expanded: true, loading: false, tables: {}, expandedDbs: new Set(), ...overrides }
}

describe('sidebar-store', () => {
  beforeEach(() => {
    useSidebarStore.setState({
      width: DEFAULT_SIDEBAR_WIDTH,
      collapsed: false,
      keyword: '',
      nodes: {},
      tableFilters: {},
      stickyDatabase: null,
      tableMenu: null,
      databaseMenu: null,
      connectionMenu: null,
      actionBusy: false
    })
  })

  it('clamps the width in both directions', () => {
    const { setWidth } = useSidebarStore.getState()

    setWidth(10)
    expect(useSidebarStore.getState().width).toBe(MIN_SIDEBAR_WIDTH)

    setWidth(10_000)
    expect(useSidebarStore.getState().width).toBe(MAX_SIDEBAR_WIDTH)
  })

  it('accepts a functional width update, like the useState it replaced', () => {
    useSidebarStore.getState().setWidth(300)
    useSidebarStore.getState().setWidth((current) => current + 16)

    expect(useSidebarStore.getState().width).toBe(316)
  })

  it('accepts functional node and filter updates', () => {
    useSidebarStore.getState().setNodes({ c1: node({ databases: ['shop'] }) })
    useSidebarStore.getState().setNodes((current) => ({
      ...current,
      c1: { ...current.c1!, loading: true }
    }))

    expect(useSidebarStore.getState().nodes.c1).toMatchObject({ loading: true, databases: ['shop'] })

    useSidebarStore.getState().setTableFilters((current) => ({ ...current, 'c1:shop': 'ord' }))
    expect(useSidebarStore.getState().tableFilters).toEqual({ 'c1:shop': 'ord' })
  })

  it('closes all three context menus at once', () => {
    const connection = { id: 'c1', name: 'prod' } as never
    useSidebarStore.setState({
      tableMenu: { x: 1, y: 2, connection, database: 'shop', table: 'orders' },
      databaseMenu: { x: 1, y: 2, connection, database: 'shop' },
      connectionMenu: { x: 1, y: 2, connection }
    })

    useSidebarStore.getState().closeMenus()

    const state = useSidebarStore.getState()
    expect(state.tableMenu).toBeNull()
    expect(state.databaseMenu).toBeNull()
    expect(state.connectionMenu).toBeNull()
  })

  it('toggles the collapsed rail', () => {
    useSidebarStore.getState().toggleCollapsed()
    expect(useSidebarStore.getState().collapsed).toBe(true)

    useSidebarStore.getState().setCollapsed(false)
    expect(useSidebarStore.getState().collapsed).toBe(false)
  })
})
