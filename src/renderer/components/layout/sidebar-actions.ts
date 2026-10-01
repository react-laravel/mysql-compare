// Every verb the sidebar can perform, in one place.
//
// Blueprint §2.8: "one `ConfirmDialog`, one menu builder per object type, so the
// context menu, the row `⋯`, the toolbar `⋯` and the Info tab's Danger Zone all
// call the same hook." These used to be 25 closures inside a 1076-line
// `Sidebar.tsx` that could only be reached by threading them through 30 props
// into `SidebarTree` and 43 into `SidebarOverlays`.
//
// Nothing here subscribes: the handlers read `getState()` when they run, so the
// object is stable and a component that only needs *actions* never re-renders
// because some unrelated slice of sidebar state changed.
import { useMemo } from 'react'
import { api, unwrap } from '@renderer/lib/api'
import { useI18n } from '@renderer/i18n'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'
import { REDIS_MAX_LISTED_KEYS } from '../../../shared/constants'
import type { ConnectionOrganizationItem, DatabaseCredentialConfig, SafeConnection, TableSchema } from '../../../shared/types'
import { tableDisplayName, tableReference, renamedTableKey } from '../../../shared/table-reference'
import type { CreateRedisKeyPayload, SidebarConfirmRequest } from './sidebar-types'

type Translate = ReturnType<typeof useI18n>['t']
// Shared across tree, menus and dialogs so their requests cannot overwrite one another.
const tableRequests = new Map<string, number>()
const databaseRequests = new Map<string, number>()
const redisFilterTimers = new Map<string, ReturnType<typeof setTimeout>>()
const redisOperations = new Map<string, string>()

/** Redis glob metacharacters are literals in the key-name search box. */
export function redisSubstringPattern(value: string): string | undefined {
  return value ? `*${value.replace(/[\\*?\[\]]/g, '\\$&')}*` : undefined
}

export function cancelSidebarRedisScans(connectionId?: string, database?: string): void {
  const exact = connectionId && database !== undefined ? getDatabaseKey(connectionId, database) : undefined
  const matches = (key: string) => exact ? key === exact : !connectionId || key.startsWith(`${connectionId}:`)
  for (const [key, timer] of redisFilterTimers) if (matches(key)) {
    clearTimeout(timer)
    redisFilterTimers.delete(key)
    tableRequests.set(key, (tableRequests.get(key) ?? 0) + 1)
  }
  for (const [key, id] of redisOperations) if (matches(key)) {
    tableRequests.set(key, (tableRequests.get(key) ?? 0) + 1)
    redisOperations.delete(key)
    void api.operations?.cancel(id).catch(() => undefined)
  }
  useSidebarStore.getState().setNodes((nodes) => Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, {
    ...node,
    ...(node.redisScans ? { redisScans: Object.fromEntries(Object.entries(node.redisScans).map(([db, scan]) => [db, matches(getDatabaseKey(id, db)) ? { ...scan, loading: false, operationId: undefined } : scan])) } : {})
  }])))
}

export function getDatabaseKey(connectionId: string, database: string): string {
  return `${connectionId}:${database}`
}

/**
 * The backend caps a Redis key listing; the tree renders a persistent warning
 * row for it (blueprint §2.10) instead of the 3s toast that used to leave the
 * list looking complete.
 */
export function isRedisKeyListTruncated(
  listedCount: number,
  totalCount: number | undefined
): boolean {
  return listedCount >= REDIS_MAX_LISTED_KEYS && (totalCount ?? listedCount) > listedCount
}

async function loadDatabaseKeyCount(
  connectionId: string,
  database: string
): Promise<number | undefined> {
  try {
    const info = await unwrap(api.db.getDatabaseInfo(connectionId, database))
    return info.tableCount
  } catch {
    return undefined
  }
}

async function loadDatabaseKeyCounts(
  connectionId: string,
  databases: string[]
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    databases.map(
      async (database) => [database, await loadDatabaseKeyCount(connectionId, database)] as const
    )
  )
  return Object.fromEntries(
    entries.flatMap(([database, count]) => (count === undefined ? [] : [[database, count]]))
  )
}

export interface SidebarActions {
  // ---- tree ---------------------------------------------------------------
  toggleConnection: (connection: SafeConnection) => Promise<void>
  toggleDatabase: (connection: SafeConnection, database: string) => Promise<void>
  refreshDatabase: (connection: SafeConnection, database: string) => Promise<void>
  scanMoreRedisKeys: (connection: SafeConnection, database: string) => Promise<void>
  setTableFilter: (connectionId: string, database: string, value: string) => void

  // ---- connection ---------------------------------------------------------
  createConnection: () => void
  openAddDatabase: (connection: SafeConnection) => void
  addDatabase: (connection: SafeConnection, database: string, credential: DatabaseCredentialConfig) => Promise<void>
  setShowAllDatabases: (connection: SafeConnection, showAll: boolean) => Promise<void>
  refreshConnectionDatabases: (connection: SafeConnection) => Promise<void>
  setDatabaseSchema: (connection: SafeConnection, database: string, schema: string) => Promise<void>
  organizeConnections: () => void
  saveConnectionOrganization: (items: ConnectionOrganizationItem[]) => Promise<void>
  editConnection: (connection: SafeConnection) => void
  createConnectionWithSSH: (connection: SafeConnection) => void
  closeConnection: (connection: SafeConnection) => Promise<void>
  requestDeleteConnection: (connection: SafeConnection) => void
  // NOTE: the unconfirmed deleter is deliberately NOT exposed. It is reachable
  // only through `runConfirmedAction({ kind: 'delete-connection' })`, so every
  // entry point gets the `ConfirmDialog`. A caller that got the raw deleter is
  // exactly how the connection dialog ended up deleting without asking.
  openSSHFiles: (connection: SafeConnection) => void
  openSSHTerminal: (connection: SafeConnection) => void

  // ---- database -----------------------------------------------------------
  openDatabaseDetails: (connection: SafeConnection, database: string) => void
  openSQLConsole: (connection: SafeConnection, database: string) => void
  openDatabaseCredential: (connection: SafeConnection, database: string) => void
  openExportDatabase: (connection: SafeConnection, database: string) => void
  openCreateRedisKey: (connection: SafeConnection, database: string) => void
  compareDatabase: (connection: SafeConnection, database: string) => void
  requestDropDatabase: (connection: SafeConnection, database: string) => void

  // ---- table / redis key --------------------------------------------------
  selectTable: (connection: SafeConnection, database: string, table: string) => void
  openTableDetails: (connection: SafeConnection, database: string, table: string) => void
  startRename: (connection: SafeConnection, database: string, table: string) => void
  cancelRename: () => void
  submitRename: (nextName: string) => Promise<void>
  requestCopyTable: (connection: SafeConnection, database: string, table: string) => void
  /** Opens the "Compare with…" target picker (blueprint §2.4). */
  compareTableWith: (connection: SafeConnection, database: string, table: string) => void
  showCreateSQL: (connection: SafeConnection, database: string, table: string) => Promise<void>
  openExportTable: (connection: SafeConnection, database: string, table: string) => void
  openImportTable: (connection: SafeConnection, database: string, table: string) => void
  requestTruncateTable: (connection: SafeConnection, database: string, table: string) => void
  requestDropTable: (connection: SafeConnection, database: string, table: string) => void

  // ---- confirmations ------------------------------------------------------
  /** `resetIdentity` only matters for `truncate-table`. */
  runConfirmedAction: (request: SidebarConfirmRequest, resetIdentity?: boolean) => Promise<void>

  // ---- dialogs ------------------------------------------------------------
  submitDatabaseCredential: () => Promise<void>
  testDatabaseCredential: () => Promise<void>
  createRedisKey: (payload: CreateRedisKeyPayload) => Promise<void>
  copyCreateSQL: () => void
}

export function createSidebarActions(t: Translate): SidebarActions {
  const sidebar = () => useSidebarStore.getState()
  const ui = () => useUIStore.getState()
  const connectionStore = () => useConnectionStore.getState()
  const toastError = (error: unknown) => ui().showToast((error as Error).message, 'error')

  const applyTables = (
    connectionId: string,
    database: string,
    tables: string[],
    keyCount: number | undefined
  ) => {
    sidebar().setNodes((state) => {
      const current = state[connectionId]
      if (!current) return state
      return {
        ...state,
        [connectionId]: {
          ...current,
          tables: { ...current.tables, [database]: tables },
          tableCounts:
            keyCount === undefined
              ? current.tableCounts
              : { ...current.tableCounts, [database]: keyCount }
        }
      }
    })
  }

  const updateNode = (id: string, update: (node: import('./sidebar-types').NodeState) => import('./sidebar-types').NodeState) => {
    sidebar().setNodes((state) => state[id] ? { ...state, [id]: update(state[id]!) } : state)
  }

  const loadDatabases = async (connection: SafeConnection) => {
    const request = (databaseRequests.get(connection.id) ?? 0) + 1
    databaseRequests.set(connection.id, request)
    sidebar().setNodes((state) => ({ ...state, [connection.id]: {
      ...(state[connection.id] ?? { expanded: true, tables: {}, expandedDbs: new Set<string>() }),
      loading: true, connectionError: undefined
    } }))
    try {
      const databases = await unwrap(api.db.listDatabases(connection.id))
      const tableCounts = connection.engine === 'redis' ? await loadDatabaseKeyCounts(connection.id, databases) : undefined
      if (databaseRequests.get(connection.id) !== request) return
      updateNode(connection.id, (node) => ({ ...node, loading: false, databases, tableCounts }))
    } catch (error) {
      if (databaseRequests.get(connection.id) !== request) return
      updateNode(connection.id, (node) => ({ ...node, loading: false, connectionError: (error as Error).message }))
    }
  }

  const loadRedisBatch = async (connection: SafeConnection, database: string, reset: boolean) => {
    const key = getDatabaseKey(connection.id, database)
    const scan = sidebar().nodes[connection.id]?.redisScans?.[database]
    if (!reset && (scan?.loading || scan?.complete || scan?.limited)) return
    if (reset) cancelSidebarRedisScans(connection.id, database)
    const filter = sidebar().tableFilters[key] ?? ''
    const cursor = reset ? '0' : scan?.cursor ?? '0'
    const request = (tableRequests.get(key) ?? 0) + 1
    tableRequests.set(key, request)
    const id = crypto.randomUUID()
    redisOperations.set(key, id)
    const currentRequest = () => tableRequests.get(key) === request && redisOperations.get(key) === id
      && Boolean(sidebar().nodes[connection.id]?.expandedDbs.has(database))
      && (sidebar().tableFilters[key] ?? '') === filter
    updateNode(connection.id, (node) => ({ ...node,
      tables: reset ? { ...node.tables, [database]: [] } : node.tables,
      databaseErrors: { ...node.databaseErrors, [database]: undefined },
      redisScans: { ...node.redisScans, [database]: { cursor, filter, complete: false, limited: false, loading: true, operationId: id } }
    }))
    try {
      const batch = await unwrap(api.db.scanRedisKeys(connection.id, database, cursor, redisSubstringPattern(filter), id))
      if (!currentRequest()) return
      updateNode(connection.id, (node) => {
        // Keep the entire SCAN batch: COUNT is a hint, and its suffix cannot be recovered from the next cursor.
        const keys = [...new Set([...(reset ? [] : node.tables[database] ?? []), ...batch.keys])].sort()
        return { ...node, tables: { ...node.tables, [database]: keys },
          redisScans: { ...node.redisScans, [database]: { cursor: batch.nextCursor, filter, complete: batch.complete, limited: !batch.complete && keys.length >= REDIS_MAX_LISTED_KEYS, loading: false } }
        }
      })
      if (reset) void loadDatabaseKeyCount(connection.id, database).then((count) => {
        if (count !== undefined && sidebar().nodes[connection.id]) updateNode(connection.id, (node) => ({ ...node, tableCounts: { ...node.tableCounts, [database]: count } }))
      })
    } catch (error) {
      if (currentRequest()) updateNode(connection.id, (node) => ({ ...node,
        databaseErrors: { ...node.databaseErrors, [database]: (error as Error).message },
        redisScans: { ...node.redisScans, [database]: { cursor, filter, complete: false, limited: false, loading: false } }
      }))
    } finally {
      if (redisOperations.get(key) === id) redisOperations.delete(key)
    }
  }

  const loadTables = async (connection: SafeConnection, database: string, chosenSchema?: string) => {
    if (connection.engine === 'redis') { await loadRedisBatch(connection, database, true); return }
    const key = getDatabaseKey(connection.id, database)
    const request = (tableRequests.get(key) ?? 0) + 1
    tableRequests.set(key, request)
    const currentRequest = () => tableRequests.get(key) === request && Boolean(sidebar().nodes[connection.id])
    updateNode(connection.id, (node) => ({ ...node,
      databaseLoading: { ...node.databaseLoading, [database]: true },
      databaseErrors: { ...node.databaseErrors, [database]: undefined }
    }))
    try {
      let schema: string | undefined
      if (connection.engine === 'postgres') {
        const schemas = await unwrap(api.db.listSchemas(connection.id, database))
        if (!currentRequest()) return
        const previous = chosenSchema ?? sidebar().nodes[connection.id]?.activeSchemas?.[database]
        schema = previous && schemas.includes(previous) ? previous : schemas.includes('public') ? 'public' : schemas[0]
        updateNode(connection.id, (node) => ({ ...node,
          schemas: { ...node.schemas, [database]: schemas },
          activeSchemas: { ...node.activeSchemas, [database]: schema ?? '' }
        }))
        if (!schema) {
          applyTables(connection.id, database, [], undefined)
          return
        }
      }
      const tables = await unwrap(api.db.listTables(connection.id, database, schema))
      if (currentRequest()) applyTables(connection.id, database, tables, undefined)
    } catch (error) {
      if (currentRequest()) updateNode(connection.id, (node) => ({ ...node,
        databaseErrors: { ...node.databaseErrors, [database]: (error as Error).message }
      }))
    } finally {
      if (currentRequest()) updateNode(connection.id, (node) => ({ ...node,
        databaseLoading: { ...node.databaseLoading, [database]: false }
      }))
    }
  }

  const refreshDatabase = (connection: SafeConnection, database: string) => loadTables(connection, database)

  const withBusy = async (run: () => Promise<void>) => {
    sidebar().setActionBusy(true)
    try {
      await run()
    } finally {
      sidebar().setActionBusy(false)
    }
  }

  const copyTable = async (connection: SafeConnection, database: string, table: string, targetTable: string) => {
    await withBusy(async () => {
      try {
        const result = await unwrap(
          api.db.copyTable({ connectionId: connection.id, database, table, targetTable })
        )
        await refreshDatabase(connection, database)
        ui().showToast(t('sidebar.toast.copiedTo', { table: tableDisplayName(result.table) }), 'success')
      } catch (error) {
        toastError(error)
      }
    })
  }

  const truncateTable = async (
    connection: SafeConnection,
    database: string,
    table: string,
    resetIdentity: boolean
  ) => {
    await withBusy(async () => {
      try {
        await unwrap(
          api.db.truncateTable({ connectionId: connection.id, database, table, resetIdentity })
        )
        await refreshDatabase(connection, database)
        ui().refreshTableData(connection.id, database, table)
        ui().showToast(t('sidebar.toast.truncatedTable', { table: tableDisplayName(table) }), 'success')
      } catch (error) {
        toastError(error)
      }
    })
  }

  const dropTable = async (connection: SafeConnection, database: string, table: string) => {
    await withBusy(async () => {
      try {
        await unwrap(api.db.dropTable({ connectionId: connection.id, database, table }))
        await refreshDatabase(connection, database)
        ui().closeTableTabs(connection.id, database, table)
        ui().markTableDropped(connection.id, database, table)
        ui().showToast(
          connection.engine === 'redis'
            ? t('redis.keyDeleted', { key: table })
            : t('sidebar.toast.droppedTable', { table: tableDisplayName(table) }),
          'success'
        )
      } catch (error) {
        toastError(error)
      }
    })
  }

  const dropDatabase = async (connection: SafeConnection, database: string) => {
    await withBusy(async () => {
      try {
        await unwrap(api.db.dropDatabase({ connectionId: connection.id, database }))
        // `markDatabaseDropped` is what prunes the tree and closes the tabs —
        // the same path `DatabaseInfoView`'s Danger Zone takes.
        ui().markDatabaseDropped(connection.id, database)
        ui().closeDatabaseTabs(connection.id, database)
        ui().showToast(t('sidebar.toast.droppedDatabase', { database }), 'success')
      } catch (error) {
        toastError(error)
      }
    })
  }

  const deleteConnection = async (connection: SafeConnection): Promise<boolean> => {
    try {
      await connectionStore().remove(connection.id)
      cancelSidebarRedisScans(connection.id)
      sidebar().setNodes((state) => {
        const { [connection.id]: _removed, ...rest } = state
        return rest
      })
      ui().closeConnectionDatabaseTabs(connection.id)
      ui().showToast(t('sidebar.toast.connectionDeleted'), 'success')
      return true
    } catch (error) {
      toastError(error)
      return false
    }
  }

  return {
    toggleConnection: async (connection) => {
      const current = sidebar().nodes[connection.id]
      if (current?.expanded) {
        if (connection.engine === 'redis') cancelSidebarRedisScans(connection.id)
        sidebar().setNodes((state) => ({
          ...state,
          [connection.id]: { ...sidebar().nodes[connection.id]!, expanded: false }
        }))
        return
      }
      if (current) {
        sidebar().setNodes((state) => ({
          ...state,
          [connection.id]: { ...current, expanded: true, loading: !current.databases }
        }))
        if (current.databases) return
      } else {
        sidebar().setNodes((state) => ({
          ...state,
          [connection.id]: { expanded: true, loading: true, tables: {}, expandedDbs: new Set() }
        }))
      }
      await loadDatabases(connection)
    },

    toggleDatabase: async (connection, database) => {
      const node = sidebar().nodes[connection.id]
      if (!node) return
      const nextExpanded = new Set(node.expandedDbs)
      if (nextExpanded.has(database)) {
        if (connection.engine === 'redis') cancelSidebarRedisScans(connection.id, database)
        nextExpanded.delete(database)
        sidebar().setNodes((state) => ({
          ...state,
          [connection.id]: { ...sidebar().nodes[connection.id]!, expandedDbs: nextExpanded }
        }))
        return
      }
      nextExpanded.add(database)
      sidebar().setNodes((state) => ({
        ...state,
        [connection.id]: { ...sidebar().nodes[connection.id]!, expandedDbs: nextExpanded }
      }))
      if (node.tables[database] && (connection.engine !== 'redis' || node.redisScans?.[database])) return
      try {
        await loadTables(connection, database)
      } catch (error) {
        toastError(error)
      }
    },

    refreshDatabase,
    scanMoreRedisKeys: (connection, database) => loadRedisBatch(connection, database, false),

    setTableFilter: (connectionId, database, value) => {
      const key = getDatabaseKey(connectionId, database)
      sidebar().setTableFilters((current) => {
        if (!value) {
          const { [key]: _removed, ...rest } = current
          return rest
        }
        return { ...current, [key]: value }
      })
      const connection = connectionStore().connections.find((entry) => entry.id === connectionId)
      if (connection?.engine === 'redis') {
        cancelSidebarRedisScans(connectionId, database)
        updateNode(connectionId, (node) => ({ ...node,
          tables: { ...node.tables, [database]: [] },
          databaseErrors: { ...node.databaseErrors, [database]: undefined },
          redisScans: { ...node.redisScans, [database]: { cursor: '0', filter: value, complete: false, limited: false, loading: true } }
        }))
        const timer = setTimeout(() => {
          redisFilterTimers.delete(key)
          if (sidebar().nodes[connectionId]?.expandedDbs.has(database)) void loadRedisBatch(connection, database, true)
        }, 300)
        redisFilterTimers.set(key, timer)
      }
    },

    createConnection: () => sidebar().setCreating(true),
    openAddDatabase: (connection) => sidebar().setAddDatabaseConnection(connection),
    addDatabase: async (connection, database, credential) => {
      const updated = await connectionStore().updateDatabaseBrowsing(connection.id, { database, credential })
      await loadDatabases(updated)
    },
    setShowAllDatabases: async (connection, showAll) => {
      try {
        const updated = await connectionStore().updateDatabaseBrowsing(connection.id, { showAll })
        await loadDatabases(updated)
      } catch (error) { toastError(error) }
    },
    refreshConnectionDatabases: loadDatabases,
    setDatabaseSchema: (connection, database, schema) => loadTables(connection, database, schema),
    organizeConnections: () => sidebar().setOrganizingConnections(true),
    saveConnectionOrganization: (items) => connectionStore().organize(items),
    editConnection: (connection) => sidebar().setEditing(connection),
    createConnectionWithSSH: (connection) => {
      sidebar().setCreating(false)
      sidebar().setEditing(null)
      sidebar().setSSHSource(connection)
    },

    closeConnection: async (connection) => {
      cancelSidebarRedisScans(connection.id)
      sidebar().setNodes((state) => {
        const { [connection.id]: _removed, ...rest } = state
        return rest
      })
      sidebar().setTableFilters((state) => {
        const prefix = `${connection.id}:`
        return Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith(prefix)))
      })
      ui().closeConnectionDatabaseTabs(connection.id)
      try {
        await connectionStore().close(connection.id)
        ui().showToast(t('sidebar.toast.connectionClosed', { name: connection.name }), 'success')
      } catch (error) {
        toastError(error)
      }
    },

    requestDeleteConnection: (connection) =>
      sidebar().setPendingConfirm({ kind: 'delete-connection', connection }),

    openSSHFiles: (connection) =>
      ui().setRightView({
        kind: 'ssh-files',
        connectionId: connection.id,
        connectionName: connection.name
      }),
    openSSHTerminal: (connection) =>
      ui().setRightView({
        kind: 'ssh-terminal',
        connectionId: connection.id,
        connectionName: connection.name
      }),

    openDatabaseDetails: (connection, database) =>
      ui().setRightView({
        kind: 'database',
        connectionId: connection.id,
        connectionName: connection.name,
        database,
        engine: connection.engine
      }),

    openSQLConsole: (connection, database) => {
      if (connection.engine === 'redis') return
      ui().setRightView({
        kind: 'sql',
        connectionId: connection.id,
        connectionName: connection.name,
        database,
        engine: connection.engine
      })
    },

    openDatabaseCredential: (connection, database) => {
      const existing = connection.databaseCredentials?.[database]
      sidebar().setDatabaseCredentialDialog({ connection, database })
      sidebar().setDatabaseCredentialUsername(existing?.username ?? connection.username)
      sidebar().setDatabaseCredentialPassword('')
      sidebar().setDatabaseCredentialUseDefault(!existing)
      sidebar().setDatabaseCredentialFeedback(null)
    },

    openExportDatabase: (connection, database) => {
      if (connection.engine === 'redis') return
      sidebar().setExportDatabaseDialog({ connectionId: connection.id, database })
    },

    openCreateRedisKey: (connection, database) =>
      sidebar().setCreateRedisKeyDialog({ connection, database }),

    // Blueprint §2.2 entrance 3: the database row is a compare endpoint. The
    // store carries a one-shot prefill request that `DiffPanel` consumes — it
    // opens the tab with setup expanded and the source already filled in.
    compareDatabase: (connection, database) => ui().requestDiffCompare(connection.id, database),

    requestDropDatabase: (connection, database) =>
      sidebar().setPendingConfirm({ kind: 'drop-database', connection, database }),

    selectTable: (connection, database, table) =>
      ui().setRightView({
        kind: 'table',
        connectionId: connection.id,
        database,
        table,
        engine: connection.engine
      }),

    openTableDetails: (connection, database, table) =>
      ui().setRightView({
        kind: 'table',
        connectionId: connection.id,
        database,
        table,
        engine: connection.engine,
        tableTab: 'info'
      }),

    // Inline for both engines now — the Redis modal is gone (blueprint §2.7).
    startRename: (connection, database, table) => {
      sidebar().setInlineRename({ connection, database, table })
      sidebar().setRenameDraft(table)
    },

    cancelRename: () => {
      if (sidebar().actionBusy) return
      sidebar().setInlineRename(null)
    },

    submitRename: async (nextName) => {
      const state = sidebar()
      if (state.actionBusy) return
      const target = state.inlineRename
      if (!target) return
      const trimmed = nextName.trim()
      if (!trimmed) {
        ui().showToast(t('sidebar.toast.newTableNameRequired'), 'error')
        return
      }
      if (trimmed === (target.connection.engine === 'postgres' ? tableReference(target.table).name : target.table)) {
        state.setInlineRename(null)
        return
      }
      await withBusy(async () => {
        try {
          const result = await unwrap(
            api.db.renameTable({
              connectionId: target.connection.id,
              database: target.database,
              table: target.table,
              newTable: target.connection.engine === 'postgres' ? renamedTableKey(target.table, trimmed) : trimmed
            })
          )
          await refreshDatabase(target.connection, target.database)
          ui().renameTableTabs(target.connection.id, target.database, target.table, result.table)
          ui().showToast(t('sidebar.toast.renamedTo', { table: tableDisplayName(result.table) }), 'success')
          sidebar().setInlineRename(null)
        } catch (error) {
          toastError(error)
        }
      })
    },

    requestCopyTable: (connection, database, table) =>
      sidebar().setPendingConfirm({
        kind: 'copy-table',
        connection,
        database,
        table,
        targetTable: renamedTableKey(table, `${tableReference(table).name}_copy`)
      }),

    // The direct route to a side-by-side table compare, which previously took
    // four levels inside Diff & Sync (blueprint §2.4). Redis keys have no
    // column model, so they are not compare endpoints.
    compareTableWith: (connection, database, table) => {
      if (connection.engine === 'redis') return
      sidebar().setTableCompareTargetDialog({ connection, database, table })
    },

    showCreateSQL: async (connection, database, table) => {
      sidebar().setCreateSQLDialog({ title: `${database}.${tableDisplayName(table)}`, sql: '', loading: true })
      try {
        const schema = await unwrap<TableSchema>(api.schema.getTable(connection.id, database, table))
        sidebar().setCreateSQLDialog({
          title: `${database}.${tableDisplayName(table)}`,
          sql: schema.createSQL,
          loading: false
        })
      } catch (error) {
        sidebar().setCreateSQLDialog(null)
        toastError(error)
      }
    },

    openExportTable: (connection, database, table) =>
      sidebar().setExportDialog({ connectionId: connection.id, database, table }),

    openImportTable: (connection, database, table) =>
      sidebar().setImportDialog({ connection, database, table }),

    requestTruncateTable: (connection, database, table) =>
      sidebar().setPendingConfirm({ kind: 'truncate-table', connection, database, table }),

    requestDropTable: (connection, database, table) =>
      sidebar().setPendingConfirm({ kind: 'drop-table', connection, database, table }),

    runConfirmedAction: async (request, resetIdentity = false) => {
      switch (request.kind) {
        case 'copy-table':
          await copyTable(request.connection, request.database, request.table, request.targetTable)
          return
        case 'truncate-table':
          await truncateTable(request.connection, request.database, request.table, resetIdentity)
          return
        case 'drop-table':
          await dropTable(request.connection, request.database, request.table)
          return
        case 'drop-database':
          await dropDatabase(request.connection, request.database)
          return
        case 'delete-connection':
          await deleteConnection(request.connection)
      }
    },

    submitDatabaseCredential: async () => {
      const state = sidebar()
      const dialog = state.databaseCredentialDialog
      if (!dialog) return
      const username = state.databaseCredentialUsername.trim()
      if (!state.databaseCredentialUseDefault && !username) {
        ui().showToast(t('sidebar.toast.databaseUsernameRequired'), 'error')
        return
      }

      await withBusy(async () => {
        try {
          await connectionStore().setDatabaseCredential(
            dialog.connection.id,
            dialog.database,
            state.databaseCredentialUseDefault
              ? {}
              : { username, password: state.databaseCredentialPassword || undefined }
          )
          const requestKey = getDatabaseKey(dialog.connection.id, dialog.database)
          tableRequests.set(requestKey, (tableRequests.get(requestKey) ?? 0) + 1)
          // The pooled connection for that database is now stale: collapse it
          // and drop its cached table list so the next expand reconnects.
          sidebar().setNodes((current) => {
            const node = current[dialog.connection.id]
            if (!node) return current
            const expandedDbs = new Set(node.expandedDbs)
            expandedDbs.delete(dialog.database)
            const { [dialog.database]: _removed, ...tables } = node.tables
            return {
              ...current,
              [dialog.connection.id]: { ...node, expandedDbs, tables,
                databaseLoading: { ...node.databaseLoading, [dialog.database]: false },
                databaseErrors: { ...node.databaseErrors, [dialog.database]: undefined }
              }
            }
          })
          for (const tab of ui().workspaceTabs) {
            const view = tab.view
            if (view.kind === 'table' && view.connectionId === dialog.connection.id && view.database === dialog.database) {
              ui().refreshTableData(view.connectionId, view.database, view.table)
            }
          }
          ui().showToast(
            t(
              state.databaseCredentialUseDefault
                ? 'sidebar.toast.databaseCredentialReset'
                : 'sidebar.toast.databaseCredentialSaved',
              { database: dialog.database }
            ),
            'success'
          )
          sidebar().setDatabaseCredentialDialog(null)
          sidebar().setDatabaseCredentialPassword('')
          sidebar().setDatabaseCredentialFeedback(null)
        } catch (error) {
          toastError(error)
        }
      })
    },

    testDatabaseCredential: async () => {
      const state = sidebar()
      const dialog = state.databaseCredentialDialog
      if (!dialog) return
      const username = state.databaseCredentialUsername.trim()
      if (!state.databaseCredentialUseDefault && !username) {
        state.setDatabaseCredentialFeedback({
          level: 'error',
          message: t('sidebar.toast.databaseUsernameRequired')
        })
        return
      }
      state.setDatabaseCredentialFeedback(null)
      await withBusy(async () => {
        try {
          const result = await unwrap(
            api.connection.testDatabaseCredential(
              dialog.connection.id,
              dialog.database,
              state.databaseCredentialUseDefault
                ? {}
                : { username, password: state.databaseCredentialPassword || undefined }
            )
          )
          sidebar().setDatabaseCredentialFeedback({ level: 'success', message: result.message })
        } catch (error) {
          sidebar().setDatabaseCredentialFeedback({
            level: 'error',
            message: (error as Error).message
          })
        }
      })
    },

    createRedisKey: async (payload) => {
      const dialog = sidebar().createRedisKeyDialog
      if (!dialog) return
      const key = payload.key.trim()
      if (!key) {
        ui().showToast(t('redis.keyRequired'), 'error')
        return
      }
      await withBusy(async () => {
        try {
          await unwrap(
            api.db.insertRow({
              connectionId: dialog.connection.id,
              database: dialog.database,
              table: key,
              values: { ...payload }
            })
          )
          await refreshDatabase(dialog.connection, dialog.database)
          ui().setRightView({
            kind: 'table',
            connectionId: dialog.connection.id,
            database: dialog.database,
            table: key,
            engine: 'redis'
          })
          ui().showToast(t('redis.keyCreated', { key }), 'success')
          sidebar().setCreateRedisKeyDialog(null)
        } catch (error) {
          toastError(error)
        }
      })
    },

    copyCreateSQL: () => {
      void navigator.clipboard?.writeText(sidebar().createSQLDialog?.sql ?? '')
      ui().showToast(t('common.sqlCopied'), 'success')
    }
  }
}

export function useSidebarActions(): SidebarActions {
  const { t } = useI18n()
  return useMemo(() => createSidebarActions(t), [t])
}
