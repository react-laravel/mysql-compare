// The channel between the global shortcut handler and whichever view owns the
// action right now.
//
// DESIGN-SYSTEM §8.1 makes `⌘F` / `⌘R` / `⌘S` / `⌘J` *global* keys with
// *contextual* targets: "focus the current view's filter", "refresh the current
// view". `useGlobalShortcuts` lives in the shell and cannot know what the
// active view's filter input is, so a view registers a handler and the shell
// dispatches to it. When nothing is registered the shell does not swallow the
// key.
//
// A view that is mounted but not visible (the workspace keeps every tab
// mounted) MUST pass `null` while inactive — `useAppAction(id, active ? fn :
// null)` — otherwise a background tab would answer for the foreground one.
import { useEffect } from 'react'

export type AppActionId =
  /** ⌘F — focus this view's filter / search / WHERE input */
  | 'focus-filter'
  /** ⌘⇧F — focus the sidebar's connection search */
  | 'focus-sidebar-search'
  /** ⌘R — refresh / re-run whatever this view shows */
  | 'refresh-view'
  /** ⌘S — save (row editor, SSH editor) */
  | 'save'
  /** ⌘J — toggle the view's bottom panel (SQL results, diff detail) */
  | 'toggle-bottom-panel'
  /**
   * No key of their own — these exist so the palette can still reach the two
   * per-view controls the data toolbar demoted into its `⋯` (blueprint §5,
   * risk 5: nothing demoted may become unreachable).
   */
  | 'open-column-picker'
  | 'export-current-view'

type Handler = () => void

/** Last registration wins: an overlay registered later shadows the view below. */
const handlers = new Map<AppActionId, Handler[]>()

export function registerAppAction(id: AppActionId, handler: Handler): () => void {
  const stack = handlers.get(id) ?? []
  stack.push(handler)
  handlers.set(id, stack)

  return () => {
    const current = handlers.get(id)
    if (!current) return
    const index = current.lastIndexOf(handler)
    if (index >= 0) current.splice(index, 1)
    if (current.length === 0) handlers.delete(id)
  }
}

export function hasAppAction(id: AppActionId): boolean {
  return (handlers.get(id)?.length ?? 0) > 0
}

/** Runs the topmost handler. Returns false when nobody claimed the action. */
export function runAppAction(id: AppActionId): boolean {
  const stack = handlers.get(id)
  const handler = stack?.[stack.length - 1]
  if (!handler) return false
  handler()
  return true
}

/** Test seam — the registry is module state and outlives a render. */
export function resetAppActions(): void {
  handlers.clear()
}

/** Registers for the component's lifetime. `null` unregisters. */
export function useAppAction(id: AppActionId, handler: Handler | null): void {
  useEffect(() => {
    if (!handler) return
    return registerAppAction(id, handler)
  }, [id, handler])
}
