// The connection → database → table/key explorer.
//
// Rebuilt on the shared `TreeRow` (blueprint §3.9): every row is a real
// `treeitem` with `aria-level`, `aria-expanded`, arrow-key navigation and
// type-ahead — connection and database rows were `<button>`s inside `<div>`s
// with no tree semantics and no keyboard reachability at all. Hover-gated
// icons are gone: each row carries a persistent `⋯` whose items come from the
// same builders the right-click menu uses.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Database,
  EllipsisVertical,
  Folder,
  KeyRound,
  PanelLeftClose,
  Plus,
  RefreshCw,
  SquareTerminal,
  Table as TableIcon,
  TriangleAlert
} from 'lucide-react'
import { EngineIcon } from '@renderer/components/icons/EngineIcon'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { DropdownMenu, type MenuItem } from '@renderer/components/ui/dropdown-menu'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { IconButton } from '@renderer/components/ui/icon-button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { SearchInput } from '@renderer/components/ui/search-input'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { TreeRow } from '@renderer/components/ui/tree-row'
import { useI18n } from '@renderer/i18n'
import { useAppAction } from '@renderer/lib/app-actions'
import { formatNumber } from '@renderer/lib/format'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'
import { useSidebarActions } from './sidebar-actions'
import {
  buildDatabaseMenuItems,
  buildConnectionMenuItems,
  buildTableMenuItems
} from './sidebar-menus'
import {
  buildSidebarRows,
  groupConnections,
  type SidebarRow,
  type SidebarRowMessage
} from './sidebar-tree-rows'
import type { StickyDatabaseContext } from './sidebar-types'

const MESSAGE_KEY: Record<SidebarRowMessage, string> = {
  noTables: 'sidebar.noTables',
  noTablesMatch: 'sidebar.noTablesMatch',
  noKeys: 'sidebar.noKeys',
  noKeysMatch: 'sidebar.noKeysMatch'
}

export function SidebarTree() {
  const { t } = useI18n()
  const actions = useSidebarActions()
  const connections = useConnectionStore((state) => state.connections)
  const refreshConnections = useConnectionStore((state) => state.refresh)
  const rightView = useUIStore((state) => state.rightView)

  const keyword = useSidebarStore((state) => state.keyword)
  const setKeyword = useSidebarStore((state) => state.setKeyword)
  const nodes = useSidebarStore((state) => state.nodes)
  const tableFilters = useSidebarStore((state) => state.tableFilters)
  const inlineRename = useSidebarStore((state) => state.inlineRename)
  const stickyDatabase = useSidebarStore((state) => state.stickyDatabase)
  const setStickyDatabase = useSidebarStore((state) => state.setStickyDatabase)
  const setConnectionMenu = useSidebarStore((state) => state.setConnectionMenu)
  const setDatabaseMenu = useSidebarStore((state) => state.setDatabaseMenu)
  const setTableMenu = useSidebarStore((state) => state.setTableMenu)
  const setCollapsed = useSidebarStore((state) => state.setCollapsed)

  const [collapsedRedisFolders, setCollapsedRedisFolders] = useState<Set<string>>(new Set())
  const [activeIndex, setActiveIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const databaseRowRefs = useRef<Record<string, { element: HTMLElement; connectionName: string; database: string }>>({})
  const typeahead = useRef({ query: '', at: 0 })

  // ⌘⇧F. The shell dispatches through `app-actions` because it cannot know
  // which input a view considers its search box.
  useAppAction(
    'focus-sidebar-search',
    useCallback(() => {
      searchRef.current?.focus()
      searchRef.current?.select()
    }, [])
  )

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    if (!query) return connections
    return connections.filter((connection) => connection.name.toLowerCase().includes(query))
  }, [connections, keyword])

  const { rows, focusables } = useMemo(
    () =>
      buildSidebarRows({
        groups: groupConnections(filtered, t('sidebar.ungroupedGroup')),
        nodes,
        tableFilters,
        collapsedRedisFolders
      }),
    [collapsedRedisFolders, filtered, nodes, t, tableFilters]
  )

  // The sticky database header (a genuinely good touch worth keeping) now lives
  // with the scroll region that produces it instead of being computed in
  // `Sidebar` and passed down.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const sync = () => {
      if (container.scrollTop < 12) {
        setStickyDatabase(null)
        return
      }
      const containerTop = container.getBoundingClientRect().top
      let next: StickyDatabaseContext | null = null
      let closestTop = Number.NEGATIVE_INFINITY
      Object.values(databaseRowRefs.current).forEach((entry) => {
        if (!entry.element.isConnected) return
        const top = entry.element.getBoundingClientRect().top - containerTop
        if (top <= 4 && top > closestTop) {
          closestTop = top
          next = { connectionName: entry.connectionName, database: entry.database }
        }
      })
      setStickyDatabase(next)
    }

    sync()
    container.addEventListener('scroll', sync)
    return () => container.removeEventListener('scroll', sync)
  }, [rows, setStickyDatabase])

  const focusRow = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), Math.max(focusables.length - 1, 0))
    setActiveIndex(clamped)
    rowRefs.current[clamped]?.focus()
  }

  const toggleRedisFolder = (folderId: string) => {
    setCollapsedRedisFolders((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  const activateRow = (row: SidebarRow) => {
    switch (row.type) {
      case 'connection':
        void actions.toggleConnection(row.connection)
        return
      case 'database':
        void actions.toggleDatabase(row.connection, row.database)
        return
      case 'redis-folder':
        toggleRedisFolder(row.folderId)
        return
      case 'table':
        actions.selectTable(row.connection, row.database, row.table)
        return
      case 'redis-key':
        actions.selectTable(row.connection, row.database, row.keyName)
    }
  }

  const overflowFor = (row: SidebarRow): MenuItem[] => {
    switch (row.type) {
      case 'connection':
        return buildConnectionMenuItems({ connection: row.connection, t, actions })
      case 'database':
        return buildDatabaseMenuItems({
          connection: row.connection,
          database: row.database,
          t,
          actions
        })
      case 'table':
        return buildTableMenuItems({
          connection: row.connection,
          database: row.database,
          table: row.table,
          t,
          actions
        })
      case 'redis-key':
        return buildTableMenuItems({
          connection: row.connection,
          database: row.database,
          table: row.keyName,
          t,
          actions
        })
      default:
        return []
    }
  }

  const openContextMenu = (event: React.MouseEvent, row: SidebarRow) => {
    event.preventDefault()
    event.stopPropagation()
    const at = { x: event.clientX, y: event.clientY }
    if (row.type === 'connection') setConnectionMenu({ ...at, connection: row.connection })
    else if (row.type === 'database')
      setDatabaseMenu({ ...at, connection: row.connection, database: row.database })
    else if (row.type === 'table')
      setTableMenu({ ...at, connection: row.connection, database: row.database, table: row.table })
    else if (row.type === 'redis-key')
      setTableMenu({
        ...at,
        connection: row.connection,
        database: row.database,
        table: row.keyName
      })
  }

  const onRowKeyDown = (event: React.KeyboardEvent, row: SidebarRow) => {
    const index = row.focusIndex ?? 0
    const meta = focusables[index]
    if (!meta) return

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusRow(index + 1)
        return
      case 'ArrowUp':
        event.preventDefault()
        focusRow(index - 1)
        return
      case 'Home':
        event.preventDefault()
        focusRow(0)
        return
      case 'End':
        event.preventDefault()
        focusRow(focusables.length - 1)
        return
      case 'ArrowRight':
        event.preventDefault()
        if (!meta.expandable) return
        if (meta.expanded) focusRow(index + 1)
        else activateRow(row)
        return
      case 'ArrowLeft':
        event.preventDefault()
        if (meta.expandable && meta.expanded) activateRow(row)
        else if (row.parentIndex != null && row.parentIndex >= 0) focusRow(row.parentIndex)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        activateRow(row)
        return
      case 'F2':
        event.preventDefault()
        if (row.type === 'table') actions.startRename(row.connection, row.database, row.table)
        else if (row.type === 'redis-key')
          actions.startRename(row.connection, row.database, row.keyName)
        return
      default:
        break
    }

    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return
    const now = Date.now()
    const state = typeahead.current
    state.query = now - state.at > 700 ? event.key : state.query + event.key
    state.at = now
    const query = state.query.toLowerCase()
    const order = [...focusables.slice(index + 1), ...focusables.slice(0, index + 1)]
    const match = order.find((candidate) => candidate.label.toLowerCase().startsWith(query))
    if (match) focusRow(match.row.focusIndex ?? 0)
  }

  // One stable object for the row being renamed: `TreeRow` resets its draft
  // whenever the `editing` prop's identity changes.
  const editing = useMemo(
    () =>
      inlineRename
        ? {
            value: inlineRename.table,
            onCommit: (next: string) => {
              if (!next.trim()) {
                actions.cancelRename()
                return
              }
              void actions.submitRename(next)
            },
            onCancel: actions.cancelRename
          }
        : undefined,
    [actions, inlineRename]
  )

  const editingFor = (connectionId: string, database: string, table: string) =>
    inlineRename &&
    inlineRename.connection.id === connectionId &&
    inlineRename.database === database &&
    inlineRename.table === table
      ? editing
      : undefined

  const sidebarMenu: MenuItem[] = [
    {
      id: 'new-connection',
      icon: Plus,
      label: t('sidebar.newConnection'),
      shortcut: 'Mod+N',
      onSelect: actions.createConnection
    },
    {
      id: 'refresh-connections',
      icon: RefreshCw,
      label: t('sidebar.refreshConnections'),
      onSelect: () => void refreshConnections()
    },
    { kind: 'separator', id: 'sep-1' },
    {
      id: 'collapse',
      icon: PanelLeftClose,
      label: t('sidebar.collapseSidebar'),
      shortcut: 'Mod+\\',
      onSelect: () => setCollapsed(true)
    }
  ]

  const renderRow = (row: SidebarRow) => {
    const index = row.focusIndex ?? -1
    const tabIndex = index === Math.min(activeIndex, Math.max(focusables.length - 1, 0)) ? 0 : -1
    const common = {
      depth: row.depth,
      tabIndex,
      setSize: row.setSize,
      posInSet: row.posInSet,
      onKeyDown: (event: React.KeyboardEvent) => onRowKeyDown(event, row),
      onContextMenu: (event: React.MouseEvent) => openContextMenu(event, row),
      onFocus: () => setActiveIndex(index),
      ref: (element: HTMLDivElement | null) => {
        rowRefs.current[index] = element
      }
    }

    switch (row.type) {
      case 'group':
        return (
          <div
            key={row.key}
            role="presentation"
            className="flex items-center justify-between px-2 pt-2 pb-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase"
          >
            <span className="truncate">{row.label}</span>
            <span>{row.count}</span>
          </div>
        )

      case 'loading':
        // DS §7.6 names this exact line as the bad case: a bare "Loading…"
        // string where the shape is known. Three row skeletons after 300ms —
        // a fast expand shows nothing at all rather than a flash.
        return (
          <div key={row.key} role="presentation" aria-busy className="px-2 py-1 pl-8">
            <span className="sr-only">{t('common.loading')}</span>
            <Skeleton variant="row" count={3} />
          </div>
        )

      case 'connection':
        return (
          <TreeRow
            {...common}
            key={row.key}
            expandable
            expanded={row.expanded}
            onToggle={() => void actions.toggleConnection(row.connection)}
            onActivate={() => void actions.toggleConnection(row.connection)}
            label={
              <span className="flex min-w-0 items-center gap-1.5">
                <EngineIcon engine={row.connection.engine} className="size-3.5 shrink-0" />
                <span className="truncate">{row.connection.name}</span>
              </span>
            }
            badges={
              // SSH files/terminal are the whole point of an SSH connection row,
              // so they stay inline and — unlike before — always visible.
              row.connection.useSSH ? (
                <span data-tree-action className="flex shrink-0 items-center gap-0.5">
                  <Badge tone="warning" size="xs">
                    SSH
                  </Badge>
                  <IconButton
                    icon={Folder}
                    label={t('sidebar.openSshFiles')}
                    size="xs"
                    variant="ghost"
                    onClick={() => actions.openSSHFiles(row.connection)}
                  />
                  <IconButton
                    icon={SquareTerminal}
                    label={t('sidebar.openSshTerminal')}
                    size="xs"
                    variant="ghost"
                    onClick={() => actions.openSSHTerminal(row.connection)}
                  />
                </span>
              ) : null
            }
            overflow={overflowFor(row)}
            overflowLabel={t('sidebar.moreActionsFor', { name: row.connection.name })}
          />
        )

      case 'database': {
        const selected =
          rightView.kind === 'database' &&
          rightView.connectionId === row.connection.id &&
          rightView.database === row.database
        return (
          <TreeRow
            {...common}
            key={row.key}
            ref={(element: HTMLDivElement | null) => {
              rowRefs.current[index] = element
              const key = `${row.connection.id}:${row.database}`
              if (!element) delete databaseRowRefs.current[key]
              else
                databaseRowRefs.current[key] = {
                  element,
                  connectionName: row.connection.name,
                  database: row.database
                }
            }}
            expandable
            expanded={row.expanded}
            selected={selected}
            icon={Database}
            label={row.database}
            onToggle={() => void actions.toggleDatabase(row.connection, row.database)}
            onActivate={() => void actions.toggleDatabase(row.connection, row.database)}
            badges={
              row.hasCustomCredential ? (
                // Persistent, because a hover-only key icon was unreachable by
                // keyboard and invisible until you happened to point at it.
                <Badge
                  tone="accent"
                  size="xs"
                  icon={KeyRound}
                  title={t('sidebar.editCustomDatabaseCredential', {
                    username: row.connection.databaseCredentials?.[row.database]?.username ?? ''
                  })}
                >
                  {t('sidebar.customAccount')}
                </Badge>
              ) : null
            }
            meta={row.keyCount === undefined ? undefined : formatNumber(row.keyCount)}
            actions={
              <IconButton
                icon={RefreshCw}
                label={t('common.refresh')}
                size="xs"
                variant="ghost"
                onClick={() => void actions.refreshDatabase(row.connection, row.database)}
              />
            }
            overflow={overflowFor(row)}
            overflowLabel={t('sidebar.moreActionsFor', { name: row.database })}
          />
        )
      }

      case 'filter':
        return (
          <div
            key={row.key}
            role="presentation"
            className="py-1 pr-1"
            style={{ paddingLeft: row.depth * 12 + 8 }}
          >
            <SearchInput
              size="sm"
              value={row.value}
              onValueChange={(value) =>
                actions.setTableFilter(row.connection.id, row.database, value)
              }
              placeholder={
                row.connection.engine === 'redis'
                  ? t('sidebar.filterKeys')
                  : t('sidebar.filterTables')
              }
              clearLabel={t('common.clear')}
            />
          </div>
        )

      case 'table': {
        const selected =
          rightView.kind === 'table' &&
          rightView.connectionId === row.connection.id &&
          rightView.database === row.database &&
          rightView.table === row.table
        return (
          <TreeRow
            {...common}
            key={row.key}
            icon={TableIcon}
            label={row.table}
            selected={selected}
            editing={editingFor(row.connection.id, row.database, row.table)}
            onActivate={() => actions.selectTable(row.connection, row.database, row.table)}
            overflow={overflowFor(row)}
            overflowLabel={t('sidebar.moreActionsFor', { name: row.table })}
          />
        )
      }

      case 'redis-folder':
        return (
          <TreeRow
            {...common}
            key={row.key}
            expandable
            expanded={row.expanded}
            icon={Folder}
            label={row.label}
            meta={formatNumber(row.count)}
            onToggle={() => toggleRedisFolder(row.folderId)}
            onActivate={() => toggleRedisFolder(row.folderId)}
          />
        )

      case 'redis-key': {
        const selected =
          rightView.kind === 'table' &&
          rightView.connectionId === row.connection.id &&
          rightView.database === row.database &&
          rightView.table === row.keyName
        return (
          <TreeRow
            {...common}
            key={row.key}
            icon={KeyRound}
            label={row.label}
            selected={selected}
            editing={editingFor(row.connection.id, row.database, row.keyName)}
            onActivate={() => actions.selectTable(row.connection, row.database, row.keyName)}
            overflow={overflowFor(row)}
            overflowLabel={t('sidebar.moreActionsFor', { name: row.keyName })}
          />
        )
      }

      case 'message':
        return (
          <div
            key={row.key}
            role="presentation"
            className="py-1 text-xs text-fg-subtle"
            style={{ paddingLeft: row.depth * 12 + 8 }}
          >
            {t(MESSAGE_KEY[row.message])}
          </div>
        )

      case 'truncated':
        return (
          <div
            key={row.key}
            role="status"
            className="py-1 pr-1"
            style={{ paddingLeft: row.depth * 12 + 8 }}
          >
            <Badge tone="warning" size="xs" icon={TriangleAlert} className="whitespace-normal">
              {t('sidebar.redisKeysTruncated', {
                shown: formatNumber(row.shown),
                total: formatNumber(row.total)
              })}
            </Badge>
          </div>
        )
    }
  }

  return (
    <>
      <div className="flex h-toolbar shrink-0 items-center gap-1 border-b border-border px-2">
        {/*
          Theme, language and Diff & Sync used to be crammed in here behind an
          unlabeled icon; they are in Settings and the titlebar now (§1.3).
        */}
        <SearchInput
          ref={searchRef}
          size="sm"
          value={keyword}
          onValueChange={setKeyword}
          placeholder={t('sidebar.searchConnection')}
          clearLabel={t('common.clear')}
          containerClassName="min-w-0 flex-1"
        />
        <DropdownMenu
          items={sidebarMenu}
          align="end"
          aria-label={t('sidebar.sidebarMenu')}
          trigger={
            <IconButton
              icon={EllipsisVertical}
              label={t('sidebar.sidebarMenu')}
              size="sm"
              variant="ghost"
            />
          }
        />
      </div>

      <ScrollArea viewportRef={scrollRef} className="relative pb-1" stickyShadow>
        {stickyDatabase ? (
          <div className="pointer-events-none sticky top-0 z-[var(--ds-z-sticky)] mx-1 mb-1 rounded-md border border-border bg-surface/95 px-2 py-1 backdrop-blur">
            <div className="truncate text-2xs text-fg-subtle">{stickyDatabase.connectionName}</div>
            <div className="truncate text-xs font-medium text-fg">{stickyDatabase.database}</div>
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <EmptyState
            size="sm"
            variant={keyword ? 'no-results' : 'first-run'}
            icon={Database}
            title={keyword ? t('sidebar.noConnectionMatch') : t('sidebar.emptyTitle')}
            description={keyword ? undefined : t('sidebar.emptyDescription')}
            action={
              keyword ? (
                <Button size="sm" onClick={() => setKeyword('')}>
                  {t('sidebar.clearSearch')}
                </Button>
              ) : (
                <Button size="sm" variant="primary" icon={Plus} onClick={actions.createConnection}>
                  {t('sidebar.newConnection')}
                </Button>
              )
            }
          />
        ) : (
          <div role="tree" aria-label={t('sidebar.treeLabel')}>
            {rows.map(renderRow)}
          </div>
        )}
      </ScrollArea>

      <div className="flex h-statusbar shrink-0 items-center border-t border-border px-1">
        <Button
          size="xs"
          variant="ghost"
          icon={PanelLeftClose}
          onClick={() => setCollapsed(true)}
          className="text-fg-subtle"
        >
          {t('sidebar.collapseSidebar')}
        </Button>
      </div>
    </>
  )
}
