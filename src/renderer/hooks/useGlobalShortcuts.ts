// One keydown listener for the whole app (blueprint §4).
//
// It replaces the effect that used to live in `Workspace.tsx:104-144`, which
// began with `if (workspaceTabs.length === 0 || !activeTabId) return` — so ⌘K
// was dead on the exact screen where a palette is most useful. Nothing here
// early-returns on an empty workspace.
import { useEffect } from 'react'
import { useShell } from '@renderer/components/layout/shell-context'
import { runAppAction, type AppActionId } from '@renderer/lib/app-actions'
import { useJobStore, isJobActive, type Job } from '@renderer/store/job-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'

/**
 * Lifted verbatim from `Workspace.tsx:68-72` — it was already correct, and it
 * is what keeps `?` and the digit shortcuts out of text fields.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

/** The job ⌘. cancels: the active tab's own job, else the oldest running one. */
export function pickCancellableJob(jobs: Map<string, Job>, activeTabId: string | null): Job | null {
  const active = Array.from(jobs.values())
    .filter(isJobActive)
    .sort((left, right) => left.startedAt - right.startedAt)
  if (active.length === 0) return null
  if (activeTabId) {
    const own = active.find((job) => job.tabId === activeTabId)
    if (own) return own
  }
  return active[0] ?? null
}

export function useGlobalShortcuts(): void {
  const shell = useShell()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return

      const editable = isEditableTarget(event.target)
      const mod = event.metaKey || event.ctrlKey
      const key = event.key
      const lower = key.toLowerCase()

      // `?` is the one binding with no modifier, so it is the one that must
      // never fire while the user is typing.
      if (!mod && !editable && key === '?') {
        event.preventDefault()
        shell.openShortcutHelp()
        return
      }

      // ---- tab cycling: Ctrl+Tab / Ctrl+Shift+Tab, ⌥←/→, ⌘PageUp/PageDown ---
      const nextTab =
        (event.ctrlKey && !event.shiftKey && key === 'Tab') ||
        (event.altKey && key === 'ArrowRight') ||
        (mod && key === 'PageDown')
      const prevTab =
        (event.ctrlKey && event.shiftKey && key === 'Tab') ||
        (event.altKey && key === 'ArrowLeft') ||
        (mod && key === 'PageUp')

      if (nextTab || prevTab) {
        const { workspaceTabs, activeTabId, setActiveTab } = useUIStore.getState()
        if (workspaceTabs.length === 0) return
        event.preventDefault()
        const index = workspaceTabs.findIndex((tab) => tab.id === activeTabId)
        const from = index < 0 ? 0 : index
        const target = nextTab
          ? (from + 1) % workspaceTabs.length
          : (from - 1 + workspaceTabs.length) % workspaceTabs.length
        const tab = workspaceTabs[target]
        if (tab) setActiveTab(tab.id)
        return
      }

      if (!mod) return

      // ⌘1…9 — jump to tab n (⌘9 is the last tab, matching every editor)
      if (!event.shiftKey && !event.altKey && /^[1-9]$/.test(key)) {
        const { workspaceTabs, setActiveTab } = useUIStore.getState()
        if (workspaceTabs.length === 0) return
        event.preventDefault()
        const digit = Number.parseInt(key, 10)
        const tab = digit === 9 ? workspaceTabs[workspaceTabs.length - 1] : workspaceTabs[digit - 1]
        if (tab) setActiveTab(tab.id)
        return
      }

      switch (lower) {
        case 'k': {
          if (event.shiftKey || event.altKey) return
          event.preventDefault()
          shell.openCommandPalette()
          return
        }
        case ',': {
          event.preventDefault()
          shell.openSettings()
          return
        }
        case 'd': {
          if (event.shiftKey || event.altKey) return
          event.preventDefault()
          useUIStore.getState().setRightView({ kind: 'diff' })
          return
        }
        case 'n': {
          event.preventDefault()
          if (event.shiftKey) {
            openSQLConsoleForActiveView()
          } else {
            useSidebarStore.getState().setCreating(true)
          }
          return
        }
        case 'w': {
          const { activeTabId, closeTab } = useUIStore.getState()
          if (!activeTabId) return
          event.preventDefault()
          closeTab(activeTabId)
          return
        }
        case '\\': {
          event.preventDefault()
          useSidebarStore.getState().toggleCollapsed()
          return
        }
        case '.': {
          const { activeTabId } = useUIStore.getState()
          const job = pickCancellableJob(useJobStore.getState().jobs, activeTabId)
          if (!job) return
          event.preventDefault()
          useJobStore.getState().cancel(job.id)
          return
        }
        case 'f': {
          if (event.shiftKey) {
            event.preventDefault()
            // The sidebar cannot answer while it is a 44px rail.
            useSidebarStore.getState().setCollapsed(false)
            // Let the expanded tree mount before asking it for focus.
            requestAnimationFrame(() => runAppAction('focus-sidebar-search'))
            return
          }
          dispatchOrRelease(event, 'focus-filter')
          return
        }
        case 'r': {
          if (event.shiftKey || event.altKey) return
          if (runAppAction('refresh-view')) {
            event.preventDefault()
            return
          }
          // No view claimed it: a table tab still has a refresh channel.
          const { rightView, refreshTableData } = useUIStore.getState()
          if (rightView.kind === 'table') {
            event.preventDefault()
            refreshTableData(rightView.connectionId, rightView.database, rightView.table)
          }
          return
        }
        case 's': {
          dispatchOrRelease(event, 'save')
          return
        }
        case 'j': {
          dispatchOrRelease(event, 'toggle-bottom-panel')
          return
        }
        default:
          return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shell])
}

/** Only swallow the key when a view actually handled it. */
function dispatchOrRelease(event: KeyboardEvent, action: AppActionId): void {
  if (runAppAction(action)) event.preventDefault()
}

/**
 * ⌘⇧N needs a database. The active view is the only place the shell can learn
 * one from, which is also what makes the command's `disabledReason` honest.
 */
function openSQLConsoleForActiveView(): void {
  const { rightView, setRightView } = useUIStore.getState()
  if (rightView.kind === 'table' || rightView.kind === 'database' || rightView.kind === 'sql') {
    setRightView({
      kind: 'sql',
      connectionId: rightView.connectionId,
      connectionName: rightView.kind === 'table' ? undefined : rightView.connectionName,
      database: rightView.database,
      engine: rightView.engine
    })
  }
}
