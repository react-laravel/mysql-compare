// 左侧侧边栏：连接列表、连接 → 数据库 → 表的树
import { useEffect, useMemo, useRef, useState } from 'react'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import { api, unwrap } from '@renderer/lib/api'
import { useI18n } from '@renderer/i18n'
import type { SafeConnection, TableSchema } from '../../../shared/types'
import { SidebarOverlays } from './SidebarOverlays'
import { SidebarTree } from './SidebarTree'
import type {
  CreateSQLDialogState,
  DatabaseMenuState,
  DatabaseRowRefEntry,
  ExportDatabaseDialogState,
  ExportDialogState,
  ImportDialogState,
  NodeState,
  RenameDialogState,
  StickyDatabaseContext,
  TableMenuState
} from './sidebar-types'

const SIDEBAR_WIDTH_STORAGE_KEY = 'mysql-compare:sidebar-width'
const DEFAULT_SIDEBAR_WIDTH = 288
const MIN_SIDEBAR_WIDTH = 260
const MAX_SIDEBAR_WIDTH = 520
const MIN_WORKSPACE_WIDTH = 360
const SIDEBAR_RESIZE_STEP = 16

function getSidebarMaxWidth(): number {
  if (typeof window === 'undefined') return MAX_SIDEBAR_WIDTH

  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - MIN_WORKSPACE_WIDTH))
}

function clampSidebarWidth(width: number): number {
  const maxWidth = getSidebarMaxWidth()
  return Math.min(maxWidth, Math.max(MIN_SIDEBAR_WIDTH, width))
}

function loadStoredSidebarWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH

  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN

  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : DEFAULT_SIDEBAR_WIDTH
}

export function Sidebar() {
  const { connections, refresh, remove } = useConnectionStore()
  const {
    rightView,
    setRightView,
    closeDatabaseTabs,
    markDatabaseDropped,
    renameTableTabs,
    refreshTableData,
    latestDatabaseDropEvent,
    latestTableDropEvent,
    showToast
  } = useUIStore()
  const { t } = useI18n()
  const [keyword, setKeyword] = useState('')
  const [editing, setEditing] = useState<SafeConnection | null>(null)
  const [creating, setCreating] = useState(false)
  const [tableFilters, setTableFilters] = useState<Record<string, string>>({})
  const [tableMenu, setTableMenu] = useState<TableMenuState | null>(null)
  const [databaseMenu, setDatabaseMenu] = useState<DatabaseMenuState | null>(null)
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [createSQLDialog, setCreateSQLDialog] = useState<CreateSQLDialogState | null>(null)
  const [exportDialog, setExportDialog] = useState<ExportDialogState | null>(null)
  const [exportDatabaseDialog, setExportDatabaseDialog] = useState<ExportDatabaseDialogState | null>(null)
  const [importDialog, setImportDialog] = useState<ImportDialogState | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [nodes, setNodes] = useState<Record<string, NodeState>>({})
  const [stickyDatabase, setStickyDatabase] = useState<StickyDatabaseContext | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => loadStoredSidebarWidth())
  const treeScrollRef = useRef<HTMLDivElement | null>(null)
  const dbRowRefs = useRef<Record<string, DatabaseRowRefEntry>>({})
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const handledDatabaseDropEventIdRef = useRef(0)
  const handledTableDropEventIdRef = useRef(0)

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    const syncSidebarWidth = () => {
      setSidebarWidth((current) => clampSidebarWidth(current))
    }

    syncSidebarWidth()
    window.addEventListener('resize', syncSidebarWidth)
    return () => window.removeEventListener('resize', syncSidebarWidth)
  }, [])

  useEffect(() => {
    if (!tableMenu && !databaseMenu) return
    const closeMenu = () => {
      setTableMenu(null)
      setDatabaseMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [databaseMenu, tableMenu])

  useEffect(() => {
    const container = treeScrollRef.current
    if (!container) return

    const syncStickyDatabase = () => {
      if (container.scrollTop < 12) {
        setStickyDatabase(null)
        return
      }

      const containerTop = container.getBoundingClientRect().top
      let nextContext: StickyDatabaseContext | null = null
      let closestTop = Number.NEGATIVE_INFINITY

      Object.values(dbRowRefs.current).forEach((entry) => {
        if (!entry.element || !entry.element.isConnected) return
        const top = entry.element.getBoundingClientRect().top - containerTop
        if (top <= 4 && top > closestTop) {
          closestTop = top
          nextContext = {
            connectionName: entry.connectionName,
            database: entry.database
          }
        }
      })

      setStickyDatabase(nextContext)
    }

    syncStickyDatabase()
    container.addEventListener('scroll', syncStickyDatabase)
    return () => container.removeEventListener('scroll', syncStickyDatabase)
  }, [connections, keyword, nodes])

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const state = resizeStateRef.current
      if (!state) return
      setSidebarWidth(clampSidebarWidth(state.startWidth + event.clientX - state.startX))
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
  }, [])

  useEffect(() => {
    if (!latestDatabaseDropEvent) return
    if (latestDatabaseDropEvent.id <= handledDatabaseDropEventIdRef.current) return

    handledDatabaseDropEventIdRef.current = latestDatabaseDropEvent.id
    setNodes((current) => {
      const connectionNode = current[latestDatabaseDropEvent.connectionId]
      if (!connectionNode?.databases?.includes(latestDatabaseDropEvent.database)) return current

      const expandedDbs = new Set(connectionNode.expandedDbs)
      expandedDbs.delete(latestDatabaseDropEvent.database)
      const { [latestDatabaseDropEvent.database]: _removedTables, ...restTables } = connectionNode.tables

      return {
        ...current,
        [latestDatabaseDropEvent.connectionId]: {
          ...connectionNode,
          databases: connectionNode.databases.filter(
            (database) => database !== latestDatabaseDropEvent.database
          ),
          tables: restTables,
          expandedDbs
        }
      }
    })
    setTableFilters((current) => {
      const key = getDatabaseKey(
        latestDatabaseDropEvent.connectionId,
        latestDatabaseDropEvent.database
      )
      if (!(key in current)) return current
      const { [key]: _removed, ...rest } = current
      return rest
    })
  }, [latestDatabaseDropEvent])

  useEffect(() => {
    if (!latestTableDropEvent) return
    if (latestTableDropEvent.id <= handledTableDropEventIdRef.current) return

    handledTableDropEventIdRef.current = latestTableDropEvent.id
    setNodes((current) => {
      const connectionNode = current[latestTableDropEvent.connectionId]
      const tables = connectionNode?.tables[latestTableDropEvent.database]
      if (!connectionNode || !tables) return current
      if (!tables.includes(latestTableDropEvent.table)) return current

      return {
        ...current,
        [latestTableDropEvent.connectionId]: {
          ...connectionNode,
          tables: {
            ...connectionNode.tables,
            [latestTableDropEvent.database]: tables.filter(
              (table) => table !== latestTableDropEvent.table
            )
          }
        }
      }
    })
  }, [latestTableDropEvent])

  const getDatabaseKey = (connectionId: string, database: string) => `${connectionId}:${database}`

  const getTableFilter = (connectionId: string, database: string) =>
    tableFilters[getDatabaseKey(connectionId, database)] ?? ''

  const setTableFilter = (connectionId: string, database: string, value: string) => {
    const key = getDatabaseKey(connectionId, database)
    setTableFilters((current) => {
      if (!value) {
        const { [key]: _removed, ...rest } = current
        return rest
      }
      return { ...current, [key]: value }
    })
  }

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    if (!query) return connections
    return connections.filter((connection) => connection.name.toLowerCase().includes(query))
  }, [connections, keyword])

  const isSelectedTable = (connectionId: string, database: string, table: string) =>
    rightView.kind === 'table' &&
    rightView.connectionId === connectionId &&
    rightView.database === database &&
    rightView.table === table

  const isSelectedDatabase = (connectionId: string, database: string) =>
    rightView.kind === 'database' &&
    rightView.connectionId === connectionId &&
    rightView.database === database

  const toggleConnection = async (conn: SafeConnection) => {
    const cur = nodes[conn.id]
    if (cur?.expanded) {
      setNodes((state) => ({ ...state, [conn.id]: { ...cur, expanded: false } }))
      return
    }
    if (cur) {
      setNodes((state) => ({
        ...state,
        [conn.id]: { ...cur, expanded: true, loading: !cur.databases }
      }))
      if (cur.databases) {
        return
      }
    } else {
      setNodes((state) => ({
        ...state,
        [conn.id]: {
          expanded: true,
          loading: true,
          tables: {},
          expandedDbs: new Set()
        }
      }))
    }
    try {
      const dbs = await unwrap(api.db.listDatabases(conn.id))
      setNodes((state) => ({
        ...state,
        [conn.id]: { ...state[conn.id]!, loading: false, databases: dbs }
      }))
    } catch (err) {
      showToast((err as Error).message, 'error')
      setNodes((state) => ({ ...state, [conn.id]: { ...state[conn.id]!, loading: false } }))
    }
  }

  const toggleDatabase = async (conn: SafeConnection, db: string) => {
    const node = nodes[conn.id]
    if (!node) return
    const nextExpanded = new Set(node.expandedDbs)
    if (nextExpanded.has(db)) {
      nextExpanded.delete(db)
      setNodes((state) => ({ ...state, [conn.id]: { ...node, expandedDbs: nextExpanded } }))
      return
    }
    nextExpanded.add(db)
    setNodes((state) => ({ ...state, [conn.id]: { ...node, expandedDbs: nextExpanded } }))
    if (!node.tables[db]) {
      try {
        const tables = await unwrap(api.db.listTables(conn.id, db))
        setNodes((state) => {
          const current = state[conn.id]!
          return { ...state, [conn.id]: { ...current, tables: { ...current.tables, [db]: tables } } }
        })
      } catch (err) {
        showToast((err as Error).message, 'error')
      }
    }
  }

  const refreshDatabase = async (conn: SafeConnection, db: string) => {
    try {
      const tables = await unwrap(api.db.listTables(conn.id, db))
      setNodes((state) => {
        const current = state[conn.id]!
        return { ...state, [conn.id]: { ...current, tables: { ...current.tables, [db]: tables } } }
      })
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  const onSelectTable = (conn: SafeConnection, db: string, table: string) => {
    setRightView({ kind: 'table', connectionId: conn.id, database: db, table, engine: conn.engine })
  }

  const openSQLConsole = (conn: SafeConnection, db: string) => {
    if (conn.engine === 'redis') return
    setRightView({ kind: 'sql', connectionId: conn.id, connectionName: conn.name, database: db, engine: conn.engine })
  }

  const openDatabaseDetails = (conn: SafeConnection, db: string) => {
    setRightView({ kind: 'database', connectionId: conn.id, connectionName: conn.name, database: db, engine: conn.engine })
  }

  const openSSHFiles = (conn: SafeConnection) => {
    setRightView({ kind: 'ssh-files', connectionId: conn.id, connectionName: conn.name })
  }

  const openSSHTerminal = (conn: SafeConnection) => {
    setRightView({ kind: 'ssh-terminal', connectionId: conn.id, connectionName: conn.name })
  }

  const openTableMenu = (
    event: React.MouseEvent<HTMLDivElement>,
    conn: SafeConnection,
    database: string,
    table: string
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setTableMenu({
      x: Math.min(event.clientX, window.innerWidth - 232),
      y: Math.min(event.clientY, window.innerHeight - 220),
      connection: conn,
      database,
      table
    })
  }

  const openDatabaseMenu = (
    event: React.MouseEvent<HTMLDivElement>,
    conn: SafeConnection,
    database: string
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setDatabaseMenu({
      x: Math.min(event.clientX, window.innerWidth - 232),
      y: Math.min(event.clientY, window.innerHeight - 208),
      connection: conn,
      database
    })
  }

  const openRenameDialog = (menu: TableMenuState) => {
    setTableMenu(null)
    setRenameDialog({ connection: menu.connection, database: menu.database, table: menu.table })
    setRenameDraft(menu.table)
  }

  const submitRename = async () => {
    if (!renameDialog) return
    const nextName = renameDraft.trim()
    if (!nextName) {
      showToast(t('sidebar.toast.newTableNameRequired'), 'error')
      return
    }
    setActionBusy(true)
    try {
      const result = await unwrap(
        api.db.renameTable({
          connectionId: renameDialog.connection.id,
          database: renameDialog.database,
          table: renameDialog.table,
          newTable: nextName
        })
      )
      await refreshDatabase(renameDialog.connection, renameDialog.database)
      renameTableTabs(
        renameDialog.connection.id,
        renameDialog.database,
        renameDialog.table,
        result.table
      )
      showToast(t('sidebar.toast.renamedTo', { table: result.table }), 'success')
      setRenameDialog(null)
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const copyTable = async (menu: TableMenuState) => {
    setTableMenu(null)
    const targetTable = `${menu.table}_copy`
    if (!confirm(t('sidebar.confirm.copyTable', { table: menu.table, targetTable }))) return
    setActionBusy(true)
    try {
      const result = await unwrap(
        api.db.copyTable({
          connectionId: menu.connection.id,
          database: menu.database,
          table: menu.table,
          targetTable
        })
      )
      await refreshDatabase(menu.connection, menu.database)
      showToast(t('sidebar.toast.copiedTo', { table: result.table }), 'success')
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const showCreateSQL = async (menu: TableMenuState) => {
    setTableMenu(null)
    setCreateSQLDialog({ title: `${menu.database}.${menu.table}`, sql: '', loading: true })
    try {
      const schema = await unwrap<TableSchema>(
        api.schema.getTable(menu.connection.id, menu.database, menu.table)
      )
      setCreateSQLDialog({
        title: `${menu.database}.${menu.table}`,
        sql: schema.createSQL,
        loading: false
      })
    } catch (err) {
      setCreateSQLDialog(null)
      showToast((err as Error).message, 'error')
    }
  }

  const openExportDialog = (menu: TableMenuState) => {
    setTableMenu(null)
    setExportDialog({
      connectionId: menu.connection.id,
      database: menu.database,
      table: menu.table
    })
  }

  const openTableDetails = (menu: TableMenuState) => {
    setTableMenu(null)
    setRightView({
      kind: 'table',
      connectionId: menu.connection.id,
      database: menu.database,
      table: menu.table,
      engine: menu.connection.engine,
      tableTab: 'info'
    })
  }

  const openExportDatabaseDialog = (connection: SafeConnection, database: string) => {
    if (connection.engine === 'redis') return
    setDatabaseMenu(null)
    setExportDatabaseDialog({
      connectionId: connection.id,
      database
    })
  }

  const openImportDialog = (menu: TableMenuState) => {
    setTableMenu(null)
    setImportDialog({
      connection: menu.connection,
      database: menu.database,
      table: menu.table
    })
  }

  const truncateTable = async (menu: TableMenuState) => {
    setTableMenu(null)
    if (!confirm(t('sidebar.confirm.truncateTable', { table: menu.table }))) return
    setActionBusy(true)
    try {
      await unwrap(
        api.db.truncateTable({
          connectionId: menu.connection.id,
          database: menu.database,
          table: menu.table
        })
      )
      await refreshDatabase(menu.connection, menu.database)
      refreshTableData(menu.connection.id, menu.database, menu.table)
      showToast(t('sidebar.toast.truncatedTable', { table: menu.table }), 'success')
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const onDelete = async (conn: SafeConnection): Promise<boolean> => {
    if (!confirm(t('sidebar.confirm.deleteConnection', { name: conn.name }))) return false
    try {
      await remove(conn.id)
      showToast(t('sidebar.toast.connectionDeleted'), 'success')
      return true
    } catch (err) {
      showToast((err as Error).message, 'error')
      return false
    }
  }

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setSidebarWidth((current) => clampSidebarWidth(current - SIDEBAR_RESIZE_STEP))
      return
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setSidebarWidth((current) => clampSidebarWidth(current + SIDEBAR_RESIZE_STEP))
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setSidebarWidth(MIN_SIDEBAR_WIDTH)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      setSidebarWidth(clampSidebarWidth(MAX_SIDEBAR_WIDTH))
    }
  }

  return (
    <>
      <div
        className="relative shrink-0 border-r border-border bg-card flex flex-col"
        style={{ width: sidebarWidth }}
      >
        <SidebarTree
          keyword={keyword}
          onKeywordChange={setKeyword}
          onCreateConnection={() => setCreating(true)}
          filteredConnections={filtered}
          nodes={nodes}
          stickyDatabase={stickyDatabase}
          treeScrollRef={treeScrollRef}
          dbRowRefs={dbRowRefs}
          getTableFilter={getTableFilter}
          isSelectedDatabase={isSelectedDatabase}
          isSelectedTable={isSelectedTable}
          onToggleConnection={toggleConnection}
          onEditConnection={setEditing}
          onOpenSSHFiles={openSSHFiles}
          onOpenSSHTerminal={openSSHTerminal}
          onToggleDatabase={toggleDatabase}
          onOpenDatabaseDetails={openDatabaseDetails}
          onOpenSQLConsole={openSQLConsole}
          onExportDatabase={openExportDatabaseDialog}
          onRefreshDatabase={refreshDatabase}
          onTableFilterChange={setTableFilter}
          onSelectTable={onSelectTable}
          onOpenDatabaseMenu={openDatabaseMenu}
          onOpenTableMenu={openTableMenu}
        />

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('sidebar.resizeSidebar')}
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={getSidebarMaxWidth()}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize bg-transparent transition-colors hover:bg-border/60 focus-visible:bg-border/60 focus-visible:outline-none"
          onMouseDown={startResize}
          onKeyDown={handleResizeKeyDown}
        />
      </div>

      <SidebarOverlays
        creating={creating}
        editing={editing}
        onConnectionDialogOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
        onConnectionSaved={refresh}
        onDeleteConnection={onDelete}
        tableMenu={tableMenu}
        onCloseTableMenu={() => setTableMenu(null)}
        databaseMenu={databaseMenu}
        onCloseDatabaseMenu={() => setDatabaseMenu(null)}
        onOpenDatabaseDetails={(menu) => {
          setDatabaseMenu(null)
          openDatabaseDetails(menu.connection, menu.database)
        }}
        onOpenDatabaseSQLConsole={(menu) => {
          setDatabaseMenu(null)
          openSQLConsole(menu.connection, menu.database)
        }}
        onExportDatabase={(menu) => openExportDatabaseDialog(menu.connection, menu.database)}
        onRefreshDatabase={(menu) => {
          setDatabaseMenu(null)
          return refreshDatabase(menu.connection, menu.database)
        }}
        onOpenTableDetails={openTableDetails}
        onRenameTable={openRenameDialog}
        onCopyTable={copyTable}
        onShowCreateSQL={showCreateSQL}
        onExportTable={openExportDialog}
        onImportTable={openImportDialog}
        onTruncateTable={truncateTable}
        renameDialog={renameDialog}
        renameDraft={renameDraft}
        actionBusy={actionBusy}
        onRenameDraftChange={setRenameDraft}
        onRenameDialogOpenChange={(open) => {
          if (!open && !actionBusy) setRenameDialog(null)
        }}
        onSubmitRename={submitRename}
        createSQLDialog={createSQLDialog}
        onCreateSQLDialogOpenChange={(open) => {
          if (!open) setCreateSQLDialog(null)
        }}
        onCopyCreateSQL={() => {
          navigator.clipboard.writeText(createSQLDialog?.sql ?? '')
          showToast(t('common.sqlCopied'), 'success')
        }}
        exportDialog={exportDialog}
        onExportDialogOpenChange={(open) => {
          if (!open) setExportDialog(null)
        }}
        exportDatabaseDialog={exportDatabaseDialog}
        onExportDatabaseDialogOpenChange={(open) => {
          if (!open) setExportDatabaseDialog(null)
        }}
        importDialog={importDialog}
        onImportDialogOpenChange={(open) => {
          if (!open) setImportDialog(null)
        }}
        onImported={() => {
          if (importDialog) return refreshDatabase(importDialog.connection, importDialog.database)
        }}
      />
    </>
  )
}
