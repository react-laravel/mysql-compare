// The sidebar shell: width, the resize separator, tree-invalidation effects,
// and the two children that do the work.
//
// This file was 1076 lines and owned 22 `useState` calls, every tree action and
// two native `confirm()`s. The state moved to `sidebar-store` (Chunk 4), the
// verbs to `sidebar-actions.ts`, and the confirmations to one `ConfirmDialog` —
// so `SidebarTree` no longer takes 30 props and `SidebarOverlays` no longer
// takes 43.
import { useEffect, useRef } from 'react'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  getSidebarMaxWidth,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_RESIZE_STEP,
  useSidebarStore
} from '@renderer/store/sidebar-store'
import { useI18n } from '@renderer/i18n'
import { getDatabaseKey } from './sidebar-actions'
import { SidebarOverlays } from './SidebarOverlays'
import { SidebarTree } from './SidebarTree'

export function Sidebar() {
  const { t } = useI18n()
  const refreshConnections = useConnectionStore((state) => state.refresh)
  const latestDatabaseDropEvent = useUIStore((state) => state.latestDatabaseDropEvent)
  const latestTableDropEvent = useUIStore((state) => state.latestTableDropEvent)

  const width = useSidebarStore((state) => state.width)
  const setWidth = useSidebarStore((state) => state.setWidth)
  const clampWidthToViewport = useSidebarStore((state) => state.clampWidthToViewport)
  const setNodes = useSidebarStore((state) => state.setNodes)
  const setTableFilters = useSidebarStore((state) => state.setTableFilters)

  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const handledDatabaseDropEventIdRef = useRef(0)
  const handledTableDropEventIdRef = useRef(0)

  useEffect(() => {
    void refreshConnections()
  }, [refreshConnections])

  // Width persists through `sidebar-store`; this only keeps it inside the
  // viewport when the window is resized.
  useEffect(() => {
    clampWidthToViewport()
    window.addEventListener('resize', clampWidthToViewport)
    return () => window.removeEventListener('resize', clampWidthToViewport)
  }, [clampWidthToViewport])

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const state = resizeStateRef.current
      if (!state) return
      setWidth(clampSidebarWidth(state.startWidth + event.clientX - state.startX))
    }
    const onMouseUp = () => {
      if (!resizeStateRef.current) return
      resizeStateRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [setWidth])

  // A database can also be dropped from its own tab's danger zone; the tree
  // listens for that instead of duplicating the drop logic.
  useEffect(() => {
    if (!latestDatabaseDropEvent) return
    if (latestDatabaseDropEvent.id <= handledDatabaseDropEventIdRef.current) return
    handledDatabaseDropEventIdRef.current = latestDatabaseDropEvent.id

    const { connectionId, database } = latestDatabaseDropEvent
    setNodes((current) => {
      const node = current[connectionId]
      if (!node?.databases?.includes(database)) return current
      const expandedDbs = new Set(node.expandedDbs)
      expandedDbs.delete(database)
      const { [database]: _removedTables, ...tables } = node.tables
      return {
        ...current,
        [connectionId]: {
          ...node,
          databases: node.databases.filter((name) => name !== database),
          tables,
          expandedDbs
        }
      }
    })
    setTableFilters((current) => {
      const key = getDatabaseKey(connectionId, database)
      if (!(key in current)) return current
      const { [key]: _removed, ...rest } = current
      return rest
    })
  }, [latestDatabaseDropEvent, setNodes, setTableFilters])

  useEffect(() => {
    if (!latestTableDropEvent) return
    if (latestTableDropEvent.id <= handledTableDropEventIdRef.current) return
    handledTableDropEventIdRef.current = latestTableDropEvent.id

    const { connectionId, database, table } = latestTableDropEvent
    setNodes((current) => {
      const node = current[connectionId]
      const tables = node?.tables[database]
      if (!node || !tables || !tables.includes(table)) return current
      return {
        ...current,
        [connectionId]: {
          ...node,
          tables: { ...node.tables, [database]: tables.filter((name) => name !== table) }
        }
      }
    })
  }, [latestTableDropEvent, setNodes])

  const onResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setWidth((current) => clampSidebarWidth(current - SIDEBAR_RESIZE_STEP))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setWidth((current) => clampSidebarWidth(current + SIDEBAR_RESIZE_STEP))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setWidth(MIN_SIDEBAR_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      setWidth(clampSidebarWidth(MAX_SIDEBAR_WIDTH))
    }
  }

  return (
    <>
      <div
        className="relative flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-border bg-surface"
        style={{ width }}
      >
        <SidebarTree />

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('sidebar.resizeSidebar')}
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={getSidebarMaxWidth()}
          aria-valuenow={width}
          tabIndex={0}
          className="absolute top-0 right-0 bottom-0 z-[var(--ds-z-resizer)] w-2 cursor-col-resize bg-transparent transition-colors hover:bg-border-strong focus-visible:bg-border-strong"
          onMouseDown={(event) => {
            resizeStateRef.current = { startX: event.clientX, startWidth: width }
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
          }}
          onDoubleClick={() => setWidth(DEFAULT_SIDEBAR_WIDTH)}
          onKeyDown={onResizeKeyDown}
        />
      </div>

      <SidebarOverlays />
    </>
  )
}
