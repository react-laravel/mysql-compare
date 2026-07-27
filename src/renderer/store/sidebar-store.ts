// Every piece of sidebar state that used to be one of the 22 `useState` calls
// in `Sidebar.tsx:94-126`.
//
// Why a store: `Sidebar` had to hand 43 props to `SidebarOverlays` and 30 to
// `SidebarTree` purely to share this state, in a codebase that already uses
// Zustand. Chunk 6 makes those two components read the store directly; this
// chunk moves the state so that rewrite is a deletion, not a redesign.
//
// Persisted: `width` and `collapsed` only. Nodes, menus and dialogs are session
// state — `NodeState.expandedDbs` is a `Set` and a restored context menu at
// coordinates from the previous run would be nonsense.
import { create, type StateCreator } from 'zustand'
import { persist, type PersistOptions } from 'zustand/middleware'
import { readLegacyKey, safeJSONStorage } from './persist'
import type { SafeConnection } from '../../shared/types'
import type {
  ConnectionMenuState,
  CreateRedisKeyDialogState,
  CreateSQLDialogState,
  DatabaseCredentialDialogState,
  DatabaseMenuState,
  ExportDatabaseDialogState,
  ExportDialogState,
  ImportDialogState,
  NodeState,
  RenameDialogState,
  SidebarConfirmRequest,
  StickyDatabaseContext,
  TableCompareTargetDialogState,
  TableMenuState
} from '@renderer/components/layout/sidebar-types'

export const SIDEBAR_STORAGE_KEY = 'mysql-compare:sidebar'
export const SIDEBAR_STORAGE_VERSION = 1
/** Pre-store key written by `Sidebar.tsx:28`; read once so widths survive. */
export const LEGACY_SIDEBAR_WIDTH_KEY = 'mysql-compare:sidebar-width'

export const DEFAULT_SIDEBAR_WIDTH = 288
export const MIN_SIDEBAR_WIDTH = 260
export const MAX_SIDEBAR_WIDTH = 520
export const MIN_WORKSPACE_WIDTH = 360
export const SIDEBAR_RESIZE_STEP = 16
/** Icon-rail width when collapsed (DESIGN-SYSTEM §9 rule 4). */
export const SIDEBAR_RAIL_WIDTH = 44

export function getSidebarMaxWidth(): number {
  if (typeof window === 'undefined') return MAX_SIDEBAR_WIDTH
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - MIN_WORKSPACE_WIDTH))
}

export function clampSidebarWidth(width: number): number {
  return Math.min(getSidebarMaxWidth(), Math.max(MIN_SIDEBAR_WIDTH, width))
}

function readLegacyWidth(): number {
  const raw = readLegacyKey(LEGACY_SIDEBAR_WIDTH_KEY)
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : DEFAULT_SIDEBAR_WIDTH
}

export interface DatabaseCredentialFeedback {
  level: 'success' | 'error'
  message: string
}

/** `useState`-shaped so the existing call sites move over unchanged. */
export type Updater<T> = T | ((previous: T) => T)

function resolve<T>(value: Updater<T>, previous: T): T {
  return typeof value === 'function' ? (value as (previous: T) => T)(previous) : value
}

export interface SidebarState {
  // ---- layout (persisted) -------------------------------------------------
  width: number
  collapsed: boolean

  // ---- tree ---------------------------------------------------------------
  keyword: string
  nodes: Record<string, NodeState>
  tableFilters: Record<string, string>
  stickyDatabase: StickyDatabaseContext | null

  // ---- context menus ------------------------------------------------------
  tableMenu: TableMenuState | null
  databaseMenu: DatabaseMenuState | null
  connectionMenu: ConnectionMenuState | null

  // ---- dialogs ------------------------------------------------------------
  creating: boolean
  editing: SafeConnection | null
  sshSource: SafeConnection | null
  /**
   * Rename is inline for every engine now (blueprint §2.7) — the Redis-only
   * modal is gone, so there is a single rename target.
   */
  inlineRename: RenameDialogState | null
  renameDraft: string
  createSQLDialog: CreateSQLDialogState | null
  createRedisKeyDialog: CreateRedisKeyDialogState | null
  exportDialog: ExportDialogState | null
  exportDatabaseDialog: ExportDatabaseDialogState | null
  importDialog: ImportDialogState | null
  /** "Compare with…" target picker (blueprint §2.4). */
  tableCompareTargetDialog: TableCompareTargetDialogState | null
  databaseCredentialDialog: DatabaseCredentialDialogState | null
  databaseCredentialUsername: string
  databaseCredentialPassword: string
  databaseCredentialUseDefault: boolean
  databaseCredentialFeedback: DatabaseCredentialFeedback | null
  /** The single destructive-confirmation queue (blueprint §2.8). */
  pendingConfirm: SidebarConfirmRequest | null

  /** True while a tree action (rename/copy/drop/…) is in flight. */
  actionBusy: boolean

  // ---- actions ------------------------------------------------------------
  setWidth: (width: Updater<number>) => void
  clampWidthToViewport: () => void
  setCollapsed: (collapsed: boolean) => void
  toggleCollapsed: () => void

  setKeyword: (keyword: string) => void
  setNodes: (nodes: Updater<Record<string, NodeState>>) => void
  setTableFilters: (filters: Updater<Record<string, string>>) => void
  setStickyDatabase: (context: StickyDatabaseContext | null) => void

  setTableMenu: (menu: TableMenuState | null) => void
  setDatabaseMenu: (menu: DatabaseMenuState | null) => void
  setConnectionMenu: (menu: ConnectionMenuState | null) => void
  closeMenus: () => void

  setCreating: (creating: boolean) => void
  setEditing: (connection: SafeConnection | null) => void
  setSSHSource: (connection: SafeConnection | null) => void
  setInlineRename: (state: RenameDialogState | null) => void
  setRenameDraft: (draft: string) => void
  setCreateSQLDialog: (state: CreateSQLDialogState | null) => void
  setCreateRedisKeyDialog: (state: CreateRedisKeyDialogState | null) => void
  setExportDialog: (state: ExportDialogState | null) => void
  setExportDatabaseDialog: (state: ExportDatabaseDialogState | null) => void
  setImportDialog: (state: ImportDialogState | null) => void
  setTableCompareTargetDialog: (state: TableCompareTargetDialogState | null) => void
  setDatabaseCredentialDialog: (state: DatabaseCredentialDialogState | null) => void
  setDatabaseCredentialUsername: (username: string) => void
  setDatabaseCredentialPassword: (password: string) => void
  setDatabaseCredentialUseDefault: (useDefault: boolean) => void
  setDatabaseCredentialFeedback: (feedback: DatabaseCredentialFeedback | null) => void
  setPendingConfirm: (request: SidebarConfirmRequest | null) => void
  setActionBusy: (busy: boolean) => void
}

export interface PersistedSidebarState {
  width: number
  collapsed: boolean
}

const sidebarStateCreator: StateCreator<SidebarState, [['zustand/persist', unknown]], [], SidebarState> = (
  set,
  get
) => ({
  width: readLegacyWidth(),
  collapsed: false,

  keyword: '',
  nodes: {},
  tableFilters: {},
  stickyDatabase: null,

  tableMenu: null,
  databaseMenu: null,
  connectionMenu: null,

  creating: false,
  editing: null,
  sshSource: null,
  inlineRename: null,
  renameDraft: '',
  createSQLDialog: null,
  createRedisKeyDialog: null,
  exportDialog: null,
  exportDatabaseDialog: null,
  importDialog: null,
  tableCompareTargetDialog: null,
  databaseCredentialDialog: null,
  databaseCredentialUsername: '',
  databaseCredentialPassword: '',
  databaseCredentialUseDefault: true,
  databaseCredentialFeedback: null,
  pendingConfirm: null,

  actionBusy: false,

  setWidth: (width) => set((state) => ({ width: clampSidebarWidth(resolve(width, state.width)) })),
  clampWidthToViewport: () => set((state) => ({ width: clampSidebarWidth(state.width) })),
  setCollapsed: (collapsed) => set({ collapsed }),
  toggleCollapsed: () => set({ collapsed: !get().collapsed }),

  setKeyword: (keyword) => set({ keyword }),
  setNodes: (nodes) => set((state) => ({ nodes: resolve(nodes, state.nodes) })),
  setTableFilters: (filters) => set((state) => ({ tableFilters: resolve(filters, state.tableFilters) })),
  setStickyDatabase: (stickyDatabase) => set({ stickyDatabase }),

  setTableMenu: (tableMenu) => set({ tableMenu }),
  setDatabaseMenu: (databaseMenu) => set({ databaseMenu }),
  setConnectionMenu: (connectionMenu) => set({ connectionMenu }),
  closeMenus: () => set({ tableMenu: null, databaseMenu: null, connectionMenu: null }),

  setCreating: (creating) => set({ creating }),
  setEditing: (editing) => set({ editing }),
  setSSHSource: (sshSource) => set({ sshSource }),
  setInlineRename: (inlineRename) => set({ inlineRename }),
  setRenameDraft: (renameDraft) => set({ renameDraft }),
  setCreateSQLDialog: (createSQLDialog) => set({ createSQLDialog }),
  setCreateRedisKeyDialog: (createRedisKeyDialog) => set({ createRedisKeyDialog }),
  setExportDialog: (exportDialog) => set({ exportDialog }),
  setExportDatabaseDialog: (exportDatabaseDialog) => set({ exportDatabaseDialog }),
  setImportDialog: (importDialog) => set({ importDialog }),
  setTableCompareTargetDialog: (tableCompareTargetDialog) => set({ tableCompareTargetDialog }),
  setDatabaseCredentialDialog: (databaseCredentialDialog) => set({ databaseCredentialDialog }),
  setDatabaseCredentialUsername: (databaseCredentialUsername) => set({ databaseCredentialUsername }),
  setDatabaseCredentialPassword: (databaseCredentialPassword) => set({ databaseCredentialPassword }),
  setDatabaseCredentialUseDefault: (databaseCredentialUseDefault) => set({ databaseCredentialUseDefault }),
  setDatabaseCredentialFeedback: (databaseCredentialFeedback) => set({ databaseCredentialFeedback }),
  setPendingConfirm: (pendingConfirm) => set({ pendingConfirm }),
  setActionBusy: (actionBusy) => set({ actionBusy })
})

const persistOptions: PersistOptions<SidebarState, PersistedSidebarState> = {
  name: SIDEBAR_STORAGE_KEY,
  version: SIDEBAR_STORAGE_VERSION,
  storage: safeJSONStorage<PersistedSidebarState>(),
  partialize: (state) => ({ width: state.width, collapsed: state.collapsed }),
  merge: (persisted, current) => {
    const stored = persisted as Partial<PersistedSidebarState> | undefined
    return {
      ...current,
      width: typeof stored?.width === 'number' ? clampSidebarWidth(stored.width) : current.width,
      collapsed: typeof stored?.collapsed === 'boolean' ? stored.collapsed : current.collapsed
    }
  }
}

export const useSidebarStore = create<SidebarState>()(persist(sidebarStateCreator, persistOptions))
