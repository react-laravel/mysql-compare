// The sidebar tree flattened into one ordered row list.
//
// Rendering the tree as nested JSX is why connection and database rows never
// got keyboard navigation: there was no single place that knew what "the next
// row" is. A flat model gives every focusable row an index and a parent index,
// which is all `↑ ↓ ← → Home End` and type-ahead need.
import type { SafeConnection } from '../../../shared/types'
import { buildRedisKeyTree, type RedisKeyTreeNode } from './redis-key-tree'
import { getDatabaseKey, isRedisKeyListTruncated } from './sidebar-actions'
import type { NodeState } from './sidebar-types'

export type SidebarRowMessage = 'noTables' | 'noTablesMatch' | 'noKeys' | 'noKeysMatch'

interface RowBase {
  key: string
  depth: number
  /** position in the flat focusable list; absent for decoration rows */
  focusIndex?: number
  parentIndex?: number
  setSize?: number
  posInSet?: number
}

export type SidebarRow = RowBase &
  (
    | { type: 'group'; label: string; count: number }
    | { type: 'connection'; connection: SafeConnection; expanded: boolean }
    | { type: 'loading' }
    | {
        type: 'database'
        connection: SafeConnection
        database: string
        expanded: boolean
        keyCount?: number
        hasCustomCredential: boolean
      }
    | { type: 'filter'; connection: SafeConnection; database: string; value: string }
    | { type: 'table'; connection: SafeConnection; database: string; table: string }
    | {
        type: 'redis-folder'
        connection: SafeConnection
        database: string
        folderId: string
        label: string
        count: number
        expanded: boolean
      }
    | {
        type: 'redis-key'
        connection: SafeConnection
        database: string
        keyName: string
        label: string
      }
    | { type: 'message'; message: SidebarRowMessage }
    | { type: 'truncated'; shown: number; total: number }
  )

export interface FocusableSidebarRow {
  row: SidebarRow
  /** the text type-ahead matches against */
  label: string
  expandable: boolean
  expanded: boolean
}

export interface SidebarRowModel {
  rows: SidebarRow[]
  focusables: FocusableSidebarRow[]
}

export function isFocusableRow(row: SidebarRow): boolean {
  return (
    row.type === 'connection' ||
    row.type === 'database' ||
    row.type === 'table' ||
    row.type === 'redis-folder' ||
    row.type === 'redis-key'
  )
}

export interface ConnectionGroup {
  key: string
  label: string
  connections: SafeConnection[]
}

/** `connection.group` or a single fallback bucket, in first-seen order. */
export function groupConnections(
  connections: SafeConnection[],
  ungroupedLabel: string
): ConnectionGroup[] {
  const groups: ConnectionGroup[] = []
  const byKey = new Map<string, ConnectionGroup>()

  connections.forEach((connection) => {
    const name = connection.group?.trim()
    const key = name || '__ungrouped'
    let group = byKey.get(key)
    if (!group) {
      group = { key, label: name || ungroupedLabel, connections: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.connections.push(connection)
  })

  return groups
}

export function buildSidebarRows({
  groups,
  nodes,
  tableFilters,
  collapsedRedisFolders
}: {
  groups: ConnectionGroup[]
  nodes: Record<string, NodeState>
  tableFilters: Record<string, string>
  collapsedRedisFolders: Set<string>
}): SidebarRowModel {
  const rows: SidebarRow[] = []

  const pushRedisNodes = (
    connection: SafeConnection,
    database: string,
    treeNodes: RedisKeyTreeNode[],
    depth: number
  ) => {
    treeNodes.forEach((node, index) => {
      if (node.keyName) {
        rows.push({
          type: 'redis-key',
          key: `${connection.id}:${database}:key:${node.keyName}`,
          depth,
          setSize: treeNodes.length,
          posInSet: index + 1,
          connection,
          database,
          keyName: node.keyName,
          label: node.label
        })
        return
      }

      const folderId = `${connection.id}:${database}:${node.id}`
      const expanded = !collapsedRedisFolders.has(folderId)
      rows.push({
        type: 'redis-folder',
        key: `folder:${folderId}`,
        depth,
        setSize: treeNodes.length,
        posInSet: index + 1,
        connection,
        database,
        folderId,
        label: node.label,
        count: node.count,
        expanded
      })
      if (expanded) pushRedisNodes(connection, database, node.children, depth + 1)
    })
  }

  groups.forEach((group) => {
    rows.push({
      type: 'group',
      key: `group:${group.key}`,
      depth: 0,
      label: group.label,
      count: group.connections.length
    })

    group.connections.forEach((connection, connectionIndex) => {
      const node = nodes[connection.id]
      const expanded = Boolean(node?.expanded)
      rows.push({
        type: 'connection',
        key: `conn:${connection.id}`,
        depth: 0,
        setSize: group.connections.length,
        posInSet: connectionIndex + 1,
        connection,
        expanded
      })

      if (!expanded || !node) return
      if (node.loading) {
        rows.push({ type: 'loading', key: `loading:${connection.id}`, depth: 1 })
      }

      const databases = node.databases ?? []
      databases.forEach((database, databaseIndex) => {
        const dbExpanded = node.expandedDbs.has(database)
        const isRedis = connection.engine === 'redis'
        const keyCount = isRedis ? node.tableCounts?.[database] : undefined
        rows.push({
          type: 'database',
          key: `db:${connection.id}:${database}`,
          depth: 1,
          setSize: databases.length,
          posInSet: databaseIndex + 1,
          connection,
          database,
          expanded: dbExpanded,
          keyCount,
          hasCustomCredential:
            connection.engine === 'postgres' &&
            connection.databaseCredentials?.[database] !== undefined
        })

        if (!dbExpanded) return

        const filterValue = tableFilters[getDatabaseKey(connection.id, database)] ?? ''
        rows.push({
          type: 'filter',
          key: `filter:${connection.id}:${database}`,
          depth: 2,
          connection,
          database,
          value: filterValue
        })

        const tables = node.tables[database]
        const query = filterValue.toLowerCase()
        const visible = (tables ?? []).filter(
          (table) => !query || table.toLowerCase().includes(query)
        )

        if (isRedis) {
          pushRedisNodes(connection, database, buildRedisKeyTree(visible), 2)
        } else {
          visible.forEach((table, tableIndex) => {
            rows.push({
              type: 'table',
              key: `table:${connection.id}:${database}:${table}`,
              depth: 2,
              setSize: visible.length,
              posInSet: tableIndex + 1,
              connection,
              database,
              table
            })
          })
        }

        if (tables && visible.length === 0) {
          rows.push({
            type: 'message',
            key: `empty:${connection.id}:${database}`,
            depth: 2,
            message: filterValue
              ? isRedis
                ? 'noKeysMatch'
                : 'noTablesMatch'
              : isRedis
                ? 'noKeys'
                : 'noTables'
          })
        }

        // The truncation warning is a row, not a toast: the old 3s toast left
        // the list looking complete (blueprint §2.10).
        if (isRedis && tables && isRedisKeyListTruncated(tables.length, keyCount)) {
          rows.push({
            type: 'truncated',
            key: `truncated:${connection.id}:${database}`,
            depth: 2,
            shown: tables.length,
            total: keyCount ?? tables.length
          })
        }
      })
    })
  })

  // Second pass: index the focusable rows and link each one to its parent so
  // `←` can move up a level.
  const focusables: FocusableSidebarRow[] = []
  const lastAtDepth: number[] = []

  rows.forEach((row) => {
    if (!isFocusableRow(row)) return
    const index = focusables.length
    row.focusIndex = index
    let parent = -1
    for (let depth = row.depth - 1; depth >= 0; depth -= 1) {
      const candidate = lastAtDepth[depth]
      if (candidate !== undefined) {
        parent = candidate
        break
      }
    }
    row.parentIndex = parent
    lastAtDepth[row.depth] = index
    lastAtDepth.length = row.depth + 1

    focusables.push({
      row,
      label: rowLabel(row),
      expandable: row.type !== 'table' && row.type !== 'redis-key',
      expanded:
        row.type === 'connection' || row.type === 'database' || row.type === 'redis-folder'
          ? row.expanded
          : false
    })
  })

  return { rows, focusables }
}

export function rowLabel(row: SidebarRow): string {
  switch (row.type) {
    case 'connection':
      return row.connection.name
    case 'database':
      return row.database
    case 'table':
      return row.table
    case 'redis-folder':
    case 'redis-key':
      return row.label
    default:
      return ''
  }
}
