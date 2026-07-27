// Settings ▸ Data & storage.
//
// The app writes six different localStorage namespaces and, before this screen,
// none of them was reachable from the UI: SQL history grew per database
// forever, hidden-column sets survived a table being dropped, and the diff
// endpoint history had no way to be cleared. These are the only supported
// clearers — nothing else should touch the keys directly.
import {
  DIFF_PANEL_PREFERENCES_KEY,
  parseDiffPanelPreferences
} from '@renderer/components/diff/diff-panel-utils'
import {
  LEGACY_SIDEBAR_WIDTH_KEY,
  SIDEBAR_STORAGE_KEY
} from '@renderer/store/sidebar-store'

export const SQL_HISTORY_KEY_PREFIX = 'mysql-compare:sql-history:'
export const HIDDEN_COLUMNS_KEY_PREFIX = 'mysql-compare:table-hidden-columns:v1'
export const SQL_EDITOR_SIZE_KEY = 'mysql-compare:sql-editor-percent'
export const SCROLL_POSITION_KEY_PREFIX = 'mysql-compare:scroll:'

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** `ScrollArea` keeps its positions in sessionStorage, not localStorage. */
function sessionStore(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function keysWithPrefix(store: Storage, prefix: string): string[] {
  const keys: string[] = []
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index)
    if (key && key.startsWith(prefix)) keys.push(key)
  }
  return keys
}

function removeAll(store: Storage, keys: string[]): number {
  for (const key of keys) {
    try {
      store.removeItem(key)
    } catch {
      /* a quota-locked storage still counts as "nothing removed" */
    }
  }
  return keys.length
}

/** Per-database SQL console history. Returns how many databases were cleared. */
export function clearSQLHistory(): number {
  const store = storage()
  if (!store) return 0
  return removeAll(store, keysWithPrefix(store, SQL_HISTORY_KEY_PREFIX))
}

/**
 * The recent source→target pairs on the Diff & Sync setup panel. The rest of
 * the diff preferences (status filter, result tab, concurrency) is deliberately
 * kept — the user asked to forget *history*, not to reset the panel.
 */
export function clearDiffEndpointHistory(): number {
  const store = storage()
  if (!store) return 0
  const raw = store.getItem(DIFF_PANEL_PREFERENCES_KEY)
  if (raw === null) return 0
  const preferences = parseDiffPanelPreferences(raw)
  const removed = preferences.endpointHistory.length
  try {
    store.setItem(
      DIFF_PANEL_PREFERENCES_KEY,
      JSON.stringify({ ...preferences, endpointHistory: [] })
    )
  } catch {
    return 0
  }
  return removed
}

/** Per-table hidden-column sets. Returns how many tables were reset. */
export function clearHiddenColumns(): number {
  const store = storage()
  if (!store) return 0
  return removeAll(store, keysWithPrefix(store, HIDDEN_COLUMNS_KEY_PREFIX))
}

/**
 * Sidebar width/collapse, the SQL split ratio and every remembered scroll
 * position. Workspace *tabs* are not touched — losing every open document is
 * not what "reset layout" means to anyone.
 */
export function resetLayout(): number {
  const store = storage()
  if (!store) return 0
  const keys = [SIDEBAR_STORAGE_KEY, LEGACY_SIDEBAR_WIDTH_KEY, SQL_EDITOR_SIZE_KEY].filter(
    (key) => store.getItem(key) !== null
  )
  let removed = removeAll(store, keys)

  const session = sessionStore()
  if (session) {
    removed += removeAll(session, keysWithPrefix(session, SCROLL_POSITION_KEY_PREFIX))
  }

  return removed
}
