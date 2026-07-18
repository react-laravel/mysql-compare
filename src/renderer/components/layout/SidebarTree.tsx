import { useMemo, useState, type MouseEvent, type MutableRefObject } from 'react'
import {
  CircleEllipsis,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileCode2,
  Folder,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  Table as TableIcon,
  X
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import type { SafeConnection } from '../../../shared/types'
import { SidebarAppMenu } from './SidebarAppMenu'
import { SidebarConnectionRow } from './SidebarConnectionRow'
import type {
  DatabaseRowRefEntry,
  NodeState,
  StickyDatabaseContext
} from './sidebar-types'

interface SidebarTreeProps {
  keyword: string
  onKeywordChange: (value: string) => void
  onCreateConnection: () => void
  filteredConnections: SafeConnection[]
  nodes: Record<string, NodeState>
  stickyDatabase: StickyDatabaseContext | null
  treeScrollRef: MutableRefObject<HTMLDivElement | null>
  dbRowRefs: MutableRefObject<Record<string, DatabaseRowRefEntry>>
  getTableFilter: (connectionId: string, database: string) => string
  isSelectedDatabase: (connectionId: string, database: string) => boolean
  isSelectedTable: (connectionId: string, database: string, table: string) => boolean
  onToggleConnection: (connection: SafeConnection) => void | Promise<void>
  onEditConnection: (connection: SafeConnection) => void
  onOpenSSHFiles: (connection: SafeConnection) => void
  onOpenSSHTerminal: (connection: SafeConnection) => void | Promise<void>
  onOpenConnectionMenu: (
    event: MouseEvent<HTMLDivElement>,
    connection: SafeConnection
  ) => void
  onToggleDatabase: (connection: SafeConnection, database: string) => void | Promise<void>
  onOpenDatabaseDetails: (connection: SafeConnection, database: string) => void
  onOpenSQLConsole: (connection: SafeConnection, database: string) => void
  onOpenDatabaseCredential: (connection: SafeConnection, database: string) => void
  onExportDatabase: (connection: SafeConnection, database: string) => void
  onCreateRedisKey: (connection: SafeConnection, database: string) => void
  onRefreshDatabase: (connection: SafeConnection, database: string) => void | Promise<void>
  onTableFilterChange: (connectionId: string, database: string, value: string) => void
  onSelectTable: (connection: SafeConnection, database: string, table: string) => void
  onOpenDatabaseMenu: (
    event: MouseEvent<HTMLDivElement>,
    connection: SafeConnection,
    database: string
  ) => void
  onOpenTableMenu: (
    event: MouseEvent<HTMLDivElement>,
    connection: SafeConnection,
    database: string,
    table: string
  ) => void
}

export function SidebarTree({
  keyword,
  onKeywordChange,
  onCreateConnection,
  filteredConnections,
  nodes,
  stickyDatabase,
  treeScrollRef,
  dbRowRefs,
  getTableFilter,
  isSelectedDatabase,
  isSelectedTable,
  onToggleConnection,
  onEditConnection,
  onOpenSSHFiles,
  onOpenSSHTerminal,
  onOpenConnectionMenu,
  onToggleDatabase,
  onOpenDatabaseDetails,
  onOpenSQLConsole,
  onOpenDatabaseCredential,
  onExportDatabase,
  onCreateRedisKey,
  onRefreshDatabase,
  onTableFilterChange,
  onSelectTable,
  onOpenDatabaseMenu,
  onOpenTableMenu
}: SidebarTreeProps) {
  const { t } = useI18n()
  const [collapsedRedisFolders, setCollapsedRedisFolders] = useState<Set<string>>(new Set())

  const toggleRedisFolder = (folderId: string) => {
    setCollapsedRedisFolders((current) => {
      const next = new Set(current)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }

  const connectionGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; connections: SafeConnection[] }> = []
    const groupByKey = new Map<string, { key: string; label: string; connections: SafeConnection[] }>()

    filteredConnections.forEach((connection) => {
      const groupName = connection.group?.trim()
      const key = groupName || '__ungrouped'
      let group = groupByKey.get(key)
      if (!group) {
        group = {
          key,
          label: groupName || t('sidebar.ungroupedGroup'),
          connections: []
        }
        groupByKey.set(key, group)
        groups.push(group)
      }
      group.connections.push(connection)
    })

    return groups
  }, [filteredConnections, t])

  return (
    <>
      <div className="flex h-[53px] items-center border-b border-border px-2">
        <div className="flex w-full items-center gap-1">
          <SidebarAppMenu />
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => onKeywordChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onKeywordChange('')
              }}
              placeholder={t('sidebar.searchConnection')}
              className="h-9 pl-7 pr-7"
            />
            {keyword && (
              <button
                type="button"
                className="absolute right-1.5 top-1/2 rounded p-0.5 text-muted-foreground -translate-y-1/2 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => onKeywordChange('')}
                title={t('common.clear')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button size="icon" variant="outline" onClick={onCreateConnection} title={t('sidebar.newConnection')}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={treeScrollRef} className="relative flex-1 overflow-auto py-1 text-sm">
        {stickyDatabase && (
          <div className="pointer-events-none sticky top-0 z-20 mx-2 mb-1 rounded-md border border-border bg-card/95 px-3 py-1.5 shadow-sm backdrop-blur">
            <div className="truncate text-[10px] text-muted-foreground">{stickyDatabase.connectionName}</div>
            <div className="truncate text-xs font-medium">{stickyDatabase.database}</div>
          </div>
        )}

        {filteredConnections.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground">{t('sidebar.noConnection')}</div>
        )}

        {connectionGroups.map((group) => (
          <div key={group.key} className="pb-1">
            <div className="mx-2 flex items-center justify-between px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <span className="truncate">{group.label}</span>
              <span>{group.connections.length}</span>
            </div>

            {group.connections.map((connection) => {
              const node = nodes[connection.id]

              return (
                <div key={connection.id}>
                  <SidebarConnectionRow
                    connection={connection}
                    expanded={Boolean(node?.expanded)}
                    onToggle={onToggleConnection}
                    onEdit={onEditConnection}
                    onOpenSSHFiles={onOpenSSHFiles}
                    onOpenSSHTerminal={onOpenSSHTerminal}
                    onOpenMenu={onOpenConnectionMenu}
                  />

                  {node?.expanded && (
                    <div className="pl-4">
                      {node.loading && (
                        <div className="px-2 py-1 text-xs text-muted-foreground">{t('common.loading')}</div>
                      )}
                      {node.databases?.map((database) => {
                        const dbExpanded = node.expandedDbs.has(database)
                        const filterValue = getTableFilter(connection.id, database)
                        const tables = node.tables[database]
                        const visibleTables = (tables ?? []).filter((table) => {
                          return !filterValue || table.toLowerCase().includes(filterValue.toLowerCase())
                        })
                        const isRedis = connection.engine === 'redis'
                        const customCredential = connection.engine === 'postgres'
                          ? connection.databaseCredentials?.[database]
                          : undefined
                        const keyCount = isRedis ? node.tableCounts?.[database] : undefined

                        return (
                          <div key={database}>
                            <div
                              ref={(element) => {
                                const key = `${connection.id}:${database}`
                                if (!element) {
                                  delete dbRowRefs.current[key]
                                  return
                                }

                                dbRowRefs.current[key] = {
                                  element,
                                  connectionName: connection.name,
                                  database
                                }
                              }}
                              className={cn(
                                'group mx-1 flex items-center rounded-md hover:bg-accent focus-within:bg-accent/70',
                                isSelectedDatabase(connection.id, database) && 'bg-accent text-foreground'
                              )}
                              onContextMenu={(event) => onOpenDatabaseMenu(event, connection, database)}
                              title={t('sidebar.databaseRightClickHint')}
                            >
                              <button
                                type="button"
                                aria-expanded={dbExpanded}
                                className="flex min-w-0 flex-1 items-center px-2 py-1 text-left focus-visible:outline-none"
                                onClick={() => onToggleDatabase(connection, database)}
                              >
                                {dbExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                                <Database className="mx-1 h-3 w-3 text-emerald-400" />
                                <span className="flex-1 truncate">{database}</span>
                                {isRedis && keyCount !== undefined && (
                                  <span className="ml-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    {keyCount.toLocaleString()}
                                  </span>
                                )}
                              </button>
                              {connection.engine === 'postgres' && (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onOpenDatabaseCredential(connection, database)
                                  }}
                                  className={cn(
                                    'mr-1 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                                    customCredential
                                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                                  )}
                                  title={customCredential
                                    ? t('sidebar.editCustomDatabaseCredential', { username: customCredential.username ?? '' })
                                    : t('sidebar.addCustomDatabaseCredential')}
                                  aria-label={customCredential
                                    ? t('sidebar.editCustomDatabaseCredential', { username: customCredential.username ?? '' })
                                    : t('sidebar.addCustomDatabaseCredential')}
                                >
                                  <KeyRound className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {dbExpanded && (
                                <div className="flex items-center pr-1">
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      onOpenDatabaseDetails(connection, database)
                                    }}
                                    className="p-1 text-muted-foreground hover:text-foreground"
                                    title={t('sidebar.overlays.databaseDetails')}
                                  >
                                    <CircleEllipsis className="h-3 w-3" />
                                  </button>
                                  {!isRedis && (
                                    <>
                                      <button
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          onOpenSQLConsole(connection, database)
                                        }}
                                        className="p-1 text-muted-foreground hover:text-foreground"
                                        title={t('sidebar.openSqlConsole', { database })}
                                      >
                                        <FileCode2 className="h-3 w-3" />
                                      </button>
                                      <button
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          onExportDatabase(connection, database)
                                        }}
                                        className="p-1 text-muted-foreground hover:text-foreground"
                                        title={t('sidebar.exportDatabase', { database })}
                                      >
                                        <Download className="h-3 w-3" />
                                      </button>
                                    </>
                                  )}
                                  {isRedis && (
                                    <button
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        onCreateRedisKey(connection, database)
                                      }}
                                      className="p-1 text-muted-foreground hover:text-foreground"
                                      title={t('sidebar.overlays.newRedisKey')}
                                    >
                                      <Plus className="h-3 w-3" />
                                    </button>
                                  )}
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      onRefreshDatabase(connection, database)
                                    }}
                                    className="p-1 text-muted-foreground hover:text-foreground"
                                    title={t('common.refresh')}
                                  >
                                    <RefreshCw className="h-3 w-3" />
                                  </button>
                                </div>
                              )}
                            </div>

                            {dbExpanded && (
                              <div className="pl-5">
                                <div className="relative my-1">
                                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                                  <Input
                                    value={filterValue}
                                    onChange={(event) =>
                                      onTableFilterChange(connection.id, database, event.target.value)
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === 'Escape') {
                                        onTableFilterChange(connection.id, database, '')
                                      }
                                    }}
                                    placeholder={isRedis ? t('sidebar.filterKeys') : t('sidebar.filterTables')}
                                    className="h-6 pl-6 pr-7 text-xs"
                                  />
                                  {filterValue && (
                                    <button
                                      type="button"
                                      className="absolute right-1.5 top-1/2 rounded p-0.5 text-muted-foreground -translate-y-1/2 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                      onClick={() => onTableFilterChange(connection.id, database, '')}
                                      title={t('common.clear')}
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                                {isRedis ? (
                                  <RedisKeyTree
                                    keys={visibleTables}
                                    collapsedFolders={collapsedRedisFolders}
                                    folderIdPrefix={`${connection.id}:${database}`}
                                    isSelectedKey={(key) => isSelectedTable(connection.id, database, key)}
                                    onToggleFolder={toggleRedisFolder}
                                    onSelectKey={(key) => onSelectTable(connection, database, key)}
                                    onOpenKeyMenu={(event, key) => onOpenTableMenu(event, connection, database, key)}
                                    rightClickHint={t('sidebar.rightClickHint')}
                                  />
                                ) : (
                                  visibleTables.map((table) => (
                                    <div
                                      key={table}
                                      role="button"
                                      tabIndex={0}
                                      className={cn(
                                        'flex cursor-pointer items-center rounded-md px-2 py-1 hover:bg-accent focus:bg-accent/70 focus:outline-none',
                                        isSelectedTable(connection.id, database, table) && 'bg-accent text-foreground'
                                      )}
                                      onClick={() => onSelectTable(connection, database, table)}
                                      onKeyDown={(event) => {
                                        if (event.key !== 'Enter' && event.key !== ' ') return
                                        event.preventDefault()
                                        onSelectTable(connection, database, table)
                                      }}
                                      onContextMenu={(event) => onOpenTableMenu(event, connection, database, table)}
                                      title={t('sidebar.rightClickHint')}
                                    >
                                      <TableIcon className="mr-1 h-3 w-3 text-muted-foreground" />
                                      <span className="flex-1 truncate text-xs">{table}</span>
                                    </div>
                                  ))
                                )}
                                {tables && visibleTables.length === 0 && (
                                  <div className="px-2 py-2 text-xs text-muted-foreground">
                                    {filterValue
                                      ? isRedis
                                        ? t('sidebar.noKeysMatch')
                                        : t('sidebar.noTablesMatch')
                                      : isRedis
                                        ? t('sidebar.noKeys')
                                        : t('sidebar.noTables')}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

interface RedisKeyTreeNode {
  id: string
  label: string
  keyName?: string
  count: number
  children: RedisKeyTreeNode[]
}

interface RedisKeyBuildNode {
  id: string
  label: string
  keyName?: string
  count: number
  children: Map<string, RedisKeyBuildNode>
}

interface RedisKeyTreeProps {
  keys: string[]
  collapsedFolders: Set<string>
  folderIdPrefix: string
  isSelectedKey: (key: string) => boolean
  onToggleFolder: (folderId: string) => void
  onSelectKey: (key: string) => void
  onOpenKeyMenu: (event: MouseEvent<HTMLDivElement>, key: string) => void
  rightClickHint: string
}

type RedisKeyTreeItemProps = Omit<RedisKeyTreeProps, 'keys'> & {
  node: RedisKeyTreeNode
  depth: number
}

function RedisKeyTree({
  keys,
  collapsedFolders,
  folderIdPrefix,
  isSelectedKey,
  onToggleFolder,
  onSelectKey,
  onOpenKeyMenu,
  rightClickHint
}: RedisKeyTreeProps) {
  const tree = useMemo(() => buildRedisKeyTree(keys), [keys])

  return (
    <div>
      {tree.map((node) => (
        <RedisKeyTreeItem
          key={node.id}
          node={node}
          depth={0}
          collapsedFolders={collapsedFolders}
          folderIdPrefix={folderIdPrefix}
          isSelectedKey={isSelectedKey}
          onToggleFolder={onToggleFolder}
          onSelectKey={onSelectKey}
          onOpenKeyMenu={onOpenKeyMenu}
          rightClickHint={rightClickHint}
        />
      ))}
    </div>
  )
}

function RedisKeyTreeItem({
  node,
  depth,
  collapsedFolders,
  folderIdPrefix,
  isSelectedKey,
  onToggleFolder,
  onSelectKey,
  onOpenKeyMenu,
  rightClickHint
}: RedisKeyTreeItemProps) {
  if (node.keyName) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={cn(
          'flex cursor-pointer items-center rounded-md px-2 py-1 hover:bg-accent focus:bg-accent/70 focus:outline-none',
          isSelectedKey(node.keyName) && 'bg-accent text-foreground'
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onSelectKey(node.keyName!)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onSelectKey(node.keyName!)
        }}
        onContextMenu={(event) => onOpenKeyMenu(event, node.keyName!)}
        title={rightClickHint}
      >
        <KeyRound className="mr-1 h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-xs">{node.label}</span>
      </div>
    )
  }

  const folderId = `${folderIdPrefix}:${node.id}`
  const expanded = !collapsedFolders.has(folderId)

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center rounded-md px-2 py-1 text-left hover:bg-accent focus:bg-accent/70 focus:outline-none"
        style={{ paddingLeft: 4 + depth * 12 }}
        onClick={() => onToggleFolder(folderId)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <Folder className="mx-1 h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs">{node.label}</span>
        <span className="ml-1 text-[10px] text-muted-foreground">{node.count}</span>
      </button>
      {expanded && node.children.map((child) => (
        <RedisKeyTreeItem
          key={child.id}
          node={child}
          depth={depth + 1}
          collapsedFolders={collapsedFolders}
          folderIdPrefix={folderIdPrefix}
          isSelectedKey={isSelectedKey}
          onToggleFolder={onToggleFolder}
          onSelectKey={onSelectKey}
          onOpenKeyMenu={onOpenKeyMenu}
          rightClickHint={rightClickHint}
        />
      ))}
    </div>
  )
}

function buildRedisKeyTree(keys: string[]): RedisKeyTreeNode[] {
  const root = new Map<string, RedisKeyBuildNode>()

  keys.forEach((key) => {
    const parts = key.split(':')
    if (parts.length <= 1) {
      root.set(`leaf:${key}`, createRedisBuildLeaf(key, key))
      return
    }

    let siblings = root
    let path = ''
    parts.forEach((part, index) => {
      const label = part || '(empty)'
      path = path ? `${path}:${part}` : part
      const last = index === parts.length - 1

      if (last) {
        siblings.set(`leaf:${key}`, createRedisBuildLeaf(label, key))
        return
      }

      const folderMapKey = `folder:${path}`
      let folder = siblings.get(folderMapKey)
      if (!folder) {
        folder = { id: path, label, count: 0, children: new Map() }
        siblings.set(folderMapKey, folder)
      }
      folder.count += 1
      siblings = folder.children
    })
  })

  return sortRedisTreeNodes(Array.from(root.values()).map(toRedisKeyTreeNode))
}

function createRedisBuildLeaf(label: string, keyName: string): RedisKeyBuildNode {
  return { id: keyName, label, keyName, count: 1, children: new Map() }
}

function toRedisKeyTreeNode(node: RedisKeyBuildNode): RedisKeyTreeNode {
  return {
    id: node.id,
    label: node.label,
    keyName: node.keyName,
    count: node.count,
    children: Array.from(node.children.values()).map(toRedisKeyTreeNode)
  }
}

function sortRedisTreeNodes(nodes: RedisKeyTreeNode[]): RedisKeyTreeNode[] {
  return nodes
    .map((node) => ({ ...node, children: sortRedisTreeNodes(node.children) }))
    .sort((left, right) => {
      if (Boolean(left.keyName) !== Boolean(right.keyName)) return left.keyName ? 1 : -1
      return left.label.localeCompare(right.label)
    })
}
