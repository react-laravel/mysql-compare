// 用于在右侧主区域切换显示什么：表数据 / 表结构 / diff
import { create } from 'zustand'
import type { DbEngine, ExportDatabaseRequest } from '../../shared/types'

let toastTimer: ReturnType<typeof setTimeout> | null = null
const tabCloseGuards = new Map<string, () => boolean>()

export type TableViewTabKind = 'data' | 'structure' | 'info'

export type RightView =
  | { kind: 'empty' }
  | { kind: 'database'; connectionId: string; database: string; connectionName?: string; engine?: DbEngine }
  | {
      kind: 'table'
      connectionId: string
      database: string
      table: string
      engine?: DbEngine
      tableTab?: TableViewTabKind
    }
  | {
      kind: 'table-compare'
      compareSessionId: string
      sourceConnectionId: string
      sourceDatabase: string
      targetConnectionId: string
      targetDatabase: string
      table: string
      comparedTables: string[]
      diffTables: string[]
    }
  | { kind: 'sql'; connectionId: string; connectionName?: string; database: string; engine?: DbEngine }
  | {
      kind: 'database-export'
      exportTaskId: string
      connectionName?: string
      request: ExportDatabaseRequest
    }
  | { kind: 'ssh-files'; connectionId: string; connectionName: string }
  | { kind: 'ssh-terminal'; connectionId: string; connectionName: string }
  | { kind: 'ssh-editor'; connectionId: string; connectionName: string; path: string }
  | { kind: 'diff' }

export type WorkspaceView = Exclude<RightView, { kind: 'empty' }>

export interface WorkspaceTab {
  id: string
  title: string
  view: WorkspaceView
}

export interface TableDropEvent {
  id: number
  connectionId: string
  database: string
  table: string
}

export interface DatabaseDropEvent {
  id: number
  connectionId: string
  database: string
}

interface UIState {
  rightView: RightView
  workspaceTabs: WorkspaceTab[]
  activeTabId: string | null
  tableReloadTokens: Record<string, number>
  latestDatabaseDropEvent: DatabaseDropEvent | null
  latestTableDropEvent: TableDropEvent | null
  setRightView: (v: RightView) => void
  setActiveTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  closeOtherTabs: (tabId: string) => void
  closeTabsToRight: (tabId: string) => void
  closeAllTabs: () => void
  moveTab: (tabId: string, targetTabId: string) => void
  registerTabCloseGuard: (tabId: string, guard: () => boolean) => () => void
  confirmSSHPathTabRetarget: (connectionId: string, oldPath: string) => boolean
  closeDatabaseTabs: (connectionId: string, database: string) => void
  closeConnectionDatabaseTabs: (connectionId: string) => void
  renameTableTabs: (connectionId: string, database: string, oldTable: string, newTable: string) => void
  closeTableTabs: (connectionId: string, database: string, table: string) => void
  moveSSHPathTabs: (connectionId: string, oldPath: string, newPath: string) => void
  refreshTableData: (connectionId: string, database: string, table: string) => void
  markDatabaseDropped: (connectionId: string, database: string) => void
  markTableDropped: (connectionId: string, database: string, table: string) => void
  toast: { message: string; level: 'info' | 'error' | 'success' } | null
  showToast: (message: string, level?: 'info' | 'error' | 'success') => void
  clearToast: () => void
}

function isSameOrDescendantRemotePath(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

function replaceRemotePathPrefix(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath
  return `${newPath}${path.slice(oldPath.length)}`
}

type ActiveState = Pick<UIState, 'activeTabId' | 'rightView'>

function compareViewReferencesTable(
  view: Extract<WorkspaceView, { kind: 'table-compare' }>,
  connectionId: string,
  database: string,
  table: string
): boolean {
  if (view.table !== table) return false

  return (
    (view.sourceConnectionId === connectionId && view.sourceDatabase === database) ||
    (view.targetConnectionId === connectionId && view.targetDatabase === database)
  )
}

function compareViewReferencesDatabase(
  view: Extract<WorkspaceView, { kind: 'table-compare' }>,
  connectionId: string,
  database: string
): boolean {
  return (
    (view.sourceConnectionId === connectionId && view.sourceDatabase === database) ||
    (view.targetConnectionId === connectionId && view.targetDatabase === database)
  )
}

function compareViewReferencesConnection(
  view: Extract<WorkspaceView, { kind: 'table-compare' }>,
  connectionId: string
): boolean {
  return view.sourceConnectionId === connectionId || view.targetConnectionId === connectionId
}

function viewReferencesDatabaseConnection(view: WorkspaceView, connectionId: string): boolean {
  return (
    (view.kind === 'database' && view.connectionId === connectionId) ||
    (view.kind === 'table' && view.connectionId === connectionId) ||
    (view.kind === 'sql' && view.connectionId === connectionId) ||
    (view.kind === 'database-export' && view.request.connectionId === connectionId) ||
    (view.kind === 'table-compare' && compareViewReferencesConnection(view, connectionId))
  )
}

function getTabId(view: WorkspaceView): string {
  if (view.kind === 'diff') return 'diff'
  if (view.kind === 'database') return `database:${view.connectionId}:${view.database}`
  if (view.kind === 'sql') return `sql:${view.connectionId}:${view.database}`
  if (view.kind === 'database-export') return `database-export:${view.exportTaskId}`
  if (view.kind === 'ssh-files') return `ssh-files:${view.connectionId}`
  if (view.kind === 'ssh-terminal') return `ssh-terminal:${view.connectionId}`
  if (view.kind === 'ssh-editor') return `ssh-editor:${view.connectionId}:${view.path}`
  if (view.kind === 'table-compare') {
    return `table-compare:${view.compareSessionId}`
  }
  return `table:${view.connectionId}:${view.database}:${view.table}`
}

function getTableReloadKey(connectionId: string, database: string, table: string): string {
  return `${connectionId}:${database}:${table}`
}

function getTabTitle(view: WorkspaceView): string {
  if (view.kind === 'diff') return 'Diff & Sync'
  if (view.kind === 'database') {
    return view.connectionName
      ? `Database · ${view.database} @ ${view.connectionName}`
      : `Database · ${view.database}`
  }
  if (view.kind === 'sql') {
    return view.connectionName
      ? `SQL · ${view.database} @ ${view.connectionName}`
      : `SQL · ${view.database}`
  }
  if (view.kind === 'database-export') {
    return view.connectionName
      ? `Export · ${view.request.database} @ ${view.connectionName}`
      : `Export · ${view.request.database}`
  }
  if (view.kind === 'ssh-files') return `SSH · ${view.connectionName}`
  if (view.kind === 'ssh-terminal') return `Terminal · ${view.connectionName}`
  if (view.kind === 'ssh-editor') return view.path.split('/').filter(Boolean).pop() || view.path
  if (view.kind === 'table-compare') return `Compare · ${view.table}`
  if (view.kind === 'table') return `${view.database} / ${view.table}`
  return ''
}

function createTab(view: WorkspaceView): WorkspaceTab {
  return {
    id: getTabId(view),
    title: getTabTitle(view),
    view
  }
}

function pickActiveState(tabs: WorkspaceTab[], preferredIndex: number): ActiveState {
  if (tabs.length === 0) {
    return {
      activeTabId: null,
      rightView: { kind: 'empty' }
    }
  }
  const nextIndex = Math.max(0, Math.min(preferredIndex, tabs.length - 1))
  const nextTab = tabs[nextIndex]!
  return {
    activeTabId: nextTab.id,
    rightView: nextTab.view
  }
}

function tabCanClose(tabId: string): boolean {
  return tabCloseGuards.get(tabId)?.() ?? true
}

function pickActiveById(tabs: WorkspaceTab[], activeTabId: string | null, preferredTabId?: string): ActiveState {
  if (tabs.length === 0) {
    return {
      activeTabId: null,
      rightView: { kind: 'empty' }
    }
  }

  const preferredTab = preferredTabId ? tabs.find((tab) => tab.id === preferredTabId) : undefined
  const activeTab = activeTabId ? tabs.find((tab) => tab.id === activeTabId) : undefined
  const nextTab = preferredTab ?? activeTab ?? tabs[0]!

  return {
    activeTabId: nextTab.id,
    rightView: nextTab.view
  }
}

export const useUIStore = create<UIState>((set) => ({
  rightView: { kind: 'empty' },
  workspaceTabs: [],
  activeTabId: null,
  tableReloadTokens: {},
  latestDatabaseDropEvent: null,
  latestTableDropEvent: null,
  setRightView: (view) =>
    set((state) => {
      if (view.kind === 'empty') {
        return { ...state, activeTabId: null, rightView: view }
      }
      const tabId = getTabId(view)
      const existing = state.workspaceTabs.find((tab) => tab.id === tabId)
      const workspaceTabs = existing
        ? state.workspaceTabs.map((tab) => (tab.id === tabId ? createTab(view) : tab))
        : [...state.workspaceTabs, createTab(view)]
      const nextTab = workspaceTabs.find((tab) => tab.id === tabId) ?? createTab(view)
      return {
        ...state,
        workspaceTabs,
        activeTabId: tabId,
        rightView: nextTab.view
      }
    }),
  setActiveTab: (tabId) =>
    set((state) => {
      if (state.activeTabId === tabId) return state
      const tab = state.workspaceTabs.find((item) => item.id === tabId)
      if (!tab) return state
      return { ...state, activeTabId: tab.id, rightView: tab.view }
    }),
  closeTab: (tabId) =>
    set((state) => {
      if (!tabCanClose(tabId)) return state
      const index = state.workspaceTabs.findIndex((tab) => tab.id === tabId)
      if (index < 0) return state
      const workspaceTabs = state.workspaceTabs.filter((tab) => tab.id !== tabId)
      if (state.activeTabId !== tabId) {
        return { ...state, workspaceTabs }
      }
      return { ...state, workspaceTabs, ...pickActiveState(workspaceTabs, index - 1) }
    }),
  closeOtherTabs: (tabId) =>
    set((state) => {
      const anchor = state.workspaceTabs.find((tab) => tab.id === tabId)
      if (!anchor) return state

      const workspaceTabs = state.workspaceTabs.filter((tab) => tab.id === tabId || !tabCanClose(tab.id))
      if (workspaceTabs.length === state.workspaceTabs.length) return state

      return {
        ...state,
        workspaceTabs,
        activeTabId: anchor.id,
        rightView: anchor.view
      }
    }),
  closeTabsToRight: (tabId) =>
    set((state) => {
      const anchorIndex = state.workspaceTabs.findIndex((tab) => tab.id === tabId)
      if (anchorIndex < 0) return state

      const workspaceTabs = state.workspaceTabs.filter(
        (tab, index) => index <= anchorIndex || !tabCanClose(tab.id)
      )
      if (workspaceTabs.length === state.workspaceTabs.length) return state
      const activeKept = workspaceTabs.some((tab) => tab.id === state.activeTabId)

      return {
        ...state,
        workspaceTabs,
        ...pickActiveById(workspaceTabs, state.activeTabId, activeKept ? undefined : tabId)
      }
    }),
  closeAllTabs: () =>
    set((state) => {
      const workspaceTabs = state.workspaceTabs.filter((tab) => !tabCanClose(tab.id))
      if (workspaceTabs.length === state.workspaceTabs.length) return state

      return {
        ...state,
        workspaceTabs,
        ...pickActiveById(workspaceTabs, state.activeTabId)
      }
    }),
  moveTab: (tabId, targetTabId) =>
    set((state) => {
      if (tabId === targetTabId) return state
      const sourceIndex = state.workspaceTabs.findIndex((tab) => tab.id === tabId)
      const targetIndex = state.workspaceTabs.findIndex((tab) => tab.id === targetTabId)
      if (sourceIndex < 0 || targetIndex < 0) return state

      const workspaceTabs = [...state.workspaceTabs]
      const [tab] = workspaceTabs.splice(sourceIndex, 1)
      if (!tab) return state
      const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
      workspaceTabs.splice(adjustedTargetIndex, 0, tab)

      return { ...state, workspaceTabs }
    }),
  registerTabCloseGuard: (tabId, guard) => {
    tabCloseGuards.set(tabId, guard)
    return () => {
      if (tabCloseGuards.get(tabId) === guard) {
        tabCloseGuards.delete(tabId)
      }
    }
  },
  confirmSSHPathTabRetarget: (connectionId, oldPath) => {
    const { workspaceTabs } = useUIStore.getState()

    for (const tab of workspaceTabs) {
      if (
        tab.view.kind === 'ssh-editor' &&
        tab.view.connectionId === connectionId &&
        isSameOrDescendantRemotePath(tab.view.path, oldPath)
      ) {
        const allow = tabCloseGuards.get(tab.id)?.() ?? true
        if (!allow) return false
      }
    }

    return true
  },
  closeDatabaseTabs: (connectionId, database) =>
    set((state) => {
      let removedActiveIndex = -1
      let changed = false
      const workspaceTabs = state.workspaceTabs.filter((tab, index) => {
        const shouldRemove =
          (tab.view.kind === 'database' &&
            tab.view.connectionId === connectionId &&
            tab.view.database === database) ||
          (tab.view.kind === 'table' &&
            tab.view.connectionId === connectionId &&
            tab.view.database === database) ||
          (tab.view.kind === 'sql' &&
            tab.view.connectionId === connectionId &&
            tab.view.database === database) ||
          (tab.view.kind === 'table-compare' &&
            compareViewReferencesDatabase(tab.view, connectionId, database))

        if (!shouldRemove) return true

        changed = true
        if (tab.id === state.activeTabId) {
          removedActiveIndex = index
        }
        return false
      })

      if (!changed) return state
      if (removedActiveIndex < 0) {
        return { ...state, workspaceTabs }
      }
      return { ...state, workspaceTabs, ...pickActiveState(workspaceTabs, removedActiveIndex - 1) }
    }),
  closeConnectionDatabaseTabs: (connectionId) =>
    set((state) => {
      let removedActiveIndex = -1
      let changed = false
      const workspaceTabs = state.workspaceTabs.filter((tab, index) => {
        const shouldRemove = viewReferencesDatabaseConnection(tab.view, connectionId)
        if (!shouldRemove) return true

        changed = true
        if (tab.id === state.activeTabId) {
          removedActiveIndex = index
        }
        return false
      })

      if (!changed) return state
      if (removedActiveIndex < 0) {
        return { ...state, workspaceTabs }
      }
      return { ...state, workspaceTabs, ...pickActiveState(workspaceTabs, removedActiveIndex - 1) }
    }),
  renameTableTabs: (connectionId, database, oldTable, newTable) =>
    set((state) => {
      const oldTabId = getTabId({ kind: 'table', connectionId, database, table: oldTable })
      const fallbackNextView: WorkspaceView = { kind: 'table', connectionId, database, table: newTable }
      const nextTabId = getTabId(fallbackNextView)
      let changed = false
      let removedActiveIndex = -1
      let activeNextView: WorkspaceView = fallbackNextView
      const workspaceTabs = state.workspaceTabs.flatMap((tab, index) => {
        if (tab.id === oldTabId) {
          changed = true
          const nextView: WorkspaceView = tab.view.kind === 'table'
            ? { ...tab.view, table: newTable }
            : fallbackNextView
          activeNextView = nextView
          return [createTab(nextView)]
        }

        if (
          tab.view.kind === 'table-compare' &&
          compareViewReferencesTable(tab.view, connectionId, database, oldTable)
        ) {
          changed = true
          if (tab.id === state.activeTabId) {
            removedActiveIndex = index
          }
          return []
        }

        return [tab]
      })
      if (!changed) return state

      if (state.activeTabId === oldTabId) {
        return {
          ...state,
          workspaceTabs,
          activeTabId: nextTabId,
          rightView: activeNextView
        }
      }

      if (removedActiveIndex >= 0) {
        return { ...state, workspaceTabs, ...pickActiveState(workspaceTabs, removedActiveIndex - 1) }
      }

      return { ...state, workspaceTabs }
    }),
  closeTableTabs: (connectionId, database, table) =>
    set((state) => {
      let removedActiveIndex = -1
      let changed = false
      const workspaceTabs = state.workspaceTabs.filter((tab, index) => {
        const shouldRemove =
          (tab.view.kind === 'table' &&
            tab.view.connectionId === connectionId &&
            tab.view.database === database &&
            tab.view.table === table) ||
          (tab.view.kind === 'table-compare' &&
            compareViewReferencesTable(tab.view, connectionId, database, table))

        if (!shouldRemove) return true

        changed = true
        if (tab.id === state.activeTabId) {
          removedActiveIndex = index
        }
        return false
      })
      if (!changed) return state
      if (removedActiveIndex < 0) {
        return { ...state, workspaceTabs }
      }
      return { ...state, workspaceTabs, ...pickActiveState(workspaceTabs, removedActiveIndex - 1) }
    }),
  moveSSHPathTabs: (connectionId, oldPath, newPath) =>
    set((state) => {
      let changed = false
      let nextActiveView: WorkspaceView | null = null
      const seen = new Set<string>()
      const workspaceTabs: WorkspaceTab[] = []

      for (const tab of state.workspaceTabs) {
        const affected =
          tab.view.kind === 'ssh-editor' &&
          tab.view.connectionId === connectionId &&
          isSameOrDescendantRemotePath(tab.view.path, oldPath)

        let nextTab = tab
        if (affected && tab.view.kind === 'ssh-editor') {
          nextTab = createTab({
            ...tab.view,
            path: replaceRemotePathPrefix(tab.view.path, oldPath, newPath)
          })
        }

        if (affected) {
          changed = true
          if (tab.id === state.activeTabId) {
            nextActiveView = nextTab.view
          }
        }

        if (seen.has(nextTab.id)) {
          changed = true
          continue
        }

        seen.add(nextTab.id)
        workspaceTabs.push(nextTab)
      }

      if (!changed) return state
      if (!nextActiveView) {
        return { ...state, workspaceTabs }
      }

      const activeTab = workspaceTabs.find((tab) => tab.id === getTabId(nextActiveView))
      if (activeTab) {
        return {
          ...state,
          workspaceTabs,
          activeTabId: activeTab.id,
          rightView: activeTab.view
        }
      }

      return { ...state, workspaceTabs, ...pickActiveState(workspaceTabs, workspaceTabs.length - 1) }
    }),
  refreshTableData: (connectionId, database, table) =>
    set((state) => {
      const key = getTableReloadKey(connectionId, database, table)
      return {
        ...state,
        tableReloadTokens: {
          ...state.tableReloadTokens,
          [key]: (state.tableReloadTokens[key] ?? 0) + 1
        }
      }
    }),
  markDatabaseDropped: (connectionId, database) =>
    set((state) => {
      return {
        ...state,
        latestDatabaseDropEvent: {
          id: (state.latestDatabaseDropEvent?.id ?? 0) + 1,
          connectionId,
          database
        }
      }
    }),
  markTableDropped: (connectionId, database, table) =>
    set((state) => {
      return {
        ...state,
        latestTableDropEvent: {
          id: (state.latestTableDropEvent?.id ?? 0) + 1,
          connectionId,
          database,
          table
        }
      }
    }),
  toast: null,
  showToast: (message, level = 'info') => {
    if (toastTimer) {
      clearTimeout(toastTimer)
    }
    set({ toast: { message, level } })
    toastTimer = setTimeout(() => {
      set({ toast: null })
      toastTimer = null
    }, 3000)
  },
  clearToast: () => {
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    set({ toast: null })
  }
}))
