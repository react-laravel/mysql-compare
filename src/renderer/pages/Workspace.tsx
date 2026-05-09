import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Database as DatabaseIcon,
  Download,
  FileCode2,
  Folder,
  GitCompareArrows,
  Search,
  SquareTerminal,
  Table as TableIcon,
  X
} from 'lucide-react'
import { Tabs } from '@renderer/components/ui/tabs'
import { Button } from '@renderer/components/ui/button'
import { DatabaseExportTaskView } from '@renderer/components/table-view/DatabaseExportTaskView'
import { DatabaseInfoView } from '@renderer/components/table-view/DatabaseInfoView'
import { TableDataView } from '@renderer/components/table-view/TableDataView'
import { TableInfoView } from '@renderer/components/table-view/TableInfoView'
import { TableStructureView } from '@renderer/components/table-view/TableStructureView'
import { DiffPanel } from '@renderer/components/diff/DiffPanel'
import { TableCompareView } from '@renderer/components/diff/TableCompareView'
import { SQLQueryView } from '@renderer/components/sql/SQLQueryView'
import { SSHFileEditor } from '@renderer/components/ssh/SSHFileEditor'
import { SSHFileManager } from '@renderer/components/ssh/SSHFileManager'
import { SSHTerminalView } from '@renderer/components/ssh/SSHTerminalView'
import {
  useUIStore,
  type TableViewTabKind,
  type WorkspaceTab,
  type WorkspaceView
} from '@renderer/store/ui-store'
import { cn } from '@renderer/lib/utils'
import { useI18n, type Translator } from '@renderer/i18n'

function isTableTabKind(value: string): value is TableViewTabKind {
  return value === 'data' || value === 'structure' || value === 'info'
}

function getTabDisplayTitle(view: WorkspaceView, t: Translator): string {
  if (view.kind === 'diff') return t('app.diffSync')
  if (view.kind === 'database') {
    const prefix = t('workspace.tabTitle.databasePrefix')
    return view.connectionName
      ? `${prefix} · ${view.database} @ ${view.connectionName}`
      : `${prefix} · ${view.database}`
  }
  if (view.kind === 'sql') {
    const prefix = t('workspace.tabTitle.sqlPrefix')
    return view.connectionName
      ? `${prefix} · ${view.database} @ ${view.connectionName}`
      : `${prefix} · ${view.database}`
  }
  if (view.kind === 'database-export') {
    const prefix = t('workspace.tabTitle.databaseExportPrefix')
    return view.connectionName
      ? `${prefix} · ${view.request.database} @ ${view.connectionName}`
      : `${prefix} · ${view.request.database}`
  }
  if (view.kind === 'table-compare') {
    return `${t('workspace.tabTitle.comparePrefix')} · ${view.table}`
  }
  if (view.kind === 'ssh-files') return `${t('workspace.tabTitle.sshFilesPrefix')} · ${view.connectionName}`
  if (view.kind === 'ssh-terminal') return `${t('workspace.tabTitle.sshTerminalPrefix')} · ${view.connectionName}`
  if (view.kind === 'ssh-editor') {
    return `${t('workspace.tabTitle.sshEditorPrefix')} · ${view.path.split('/').filter(Boolean).pop() ?? view.path}`
  }
  return view.table
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

export function Workspace() {
  const {
    workspaceTabs,
    activeTabId,
    rightView,
    setActiveTab,
    closeTab,
    closeOtherTabs,
    closeTabsToRight,
    closeAllTabs,
    moveTab
  } = useUIStore()
  const { t } = useI18n()
  const [tableTabs, setTableTabs] = useState<Record<string, TableViewTabKind>>({})
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)
  const [quickSwitchOpen, setQuickSwitchOpen] = useState(false)
  const [quickSwitchQuery, setQuickSwitchQuery] = useState('')
  const [quickSwitchIndex, setQuickSwitchIndex] = useState(0)
  const previousTabsRef = useRef<WorkspaceTab[]>([])
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const quickSwitchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const previousTabs = previousTabsRef.current
    setTableTabs((current) => {
      const alive = new Set(workspaceTabs.map((tab) => tab.id))
      const next = Object.fromEntries(
        Object.entries(current).filter(([tabId]) => alive.has(tabId))
      ) as Record<string, TableViewTabKind>

      workspaceTabs.forEach((tab, index) => {
        const previousTab = previousTabs[index]
        if (
          previousTab?.view.kind === 'table' &&
          tab.view.kind === 'table' &&
          previousTab.id !== tab.id &&
          previousTab.view.connectionId === tab.view.connectionId &&
          previousTab.view.database === tab.view.database &&
          current[previousTab.id] &&
          !next[tab.id]
        ) {
          next[tab.id] = current[previousTab.id]!
        }
      })

      return next
    })
    previousTabsRef.current = workspaceTabs
  }, [workspaceTabs])

  useEffect(() => {
    setTableTabs((current) => {
      let changed = false
      const next = { ...current }

      workspaceTabs.forEach((tab) => {
        if (tab.view.kind !== 'table' || !tab.view.tableTab) return
        if (next[tab.id] === tab.view.tableTab) return
        next[tab.id] = tab.view.tableTab
        changed = true
      })

      return changed ? next : current
    })
  }, [workspaceTabs])

  const activeTab = workspaceTabs.find((tab) => tab.id === activeTabId) ?? null

  useEffect(() => {
    if (!activeTabId) return
    tabButtonRefs.current[activeTabId]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return
      if (workspaceTabs.length === 0 || !activeTabId) return

      const activeIndex = workspaceTabs.findIndex((tab) => tab.id === activeTabId)
      if (activeIndex < 0) return

      const isCommand = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (isCommand && key === 'k') {
        event.preventDefault()
        setQuickSwitchQuery('')
        setQuickSwitchIndex(0)
        setQuickSwitchOpen(true)
        return
      }

      if (isCommand && key === 'w') {
        event.preventDefault()
        closeTab(activeTabId)
        return
      }

      const previousRequested = (isCommand && event.key === 'PageUp') || (event.altKey && event.key === 'ArrowLeft')
      const nextRequested = (isCommand && event.key === 'PageDown') || (event.altKey && event.key === 'ArrowRight')

      if (!previousRequested && !nextRequested) return

      event.preventDefault()
      const nextIndex = nextRequested
        ? (activeIndex + 1) % workspaceTabs.length
        : (activeIndex - 1 + workspaceTabs.length) % workspaceTabs.length
      const nextTab = workspaceTabs[nextIndex]
      if (nextTab) setActiveTab(nextTab.id)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTabId, closeTab, setActiveTab, workspaceTabs])

  const quickSwitchMatches = useMemo(() => {
    const query = quickSwitchQuery.trim().toLowerCase()
    return workspaceTabs
      .map((tab) => ({
        tab,
        title: getTabDisplayTitle(tab.view, t)
      }))
      .filter(({ tab, title }) => {
        if (!query) return true
        return title.toLowerCase().includes(query) || tab.id.toLowerCase().includes(query)
      })
  }, [quickSwitchQuery, t, workspaceTabs])

  useEffect(() => {
    if (!quickSwitchOpen) return
    requestAnimationFrame(() => quickSwitchInputRef.current?.focus())
  }, [quickSwitchOpen])

  useEffect(() => {
    setQuickSwitchIndex(0)
  }, [quickSwitchQuery])

  useEffect(() => {
    if (!tabMenu) return

    const closeMenu = () => setTabMenu(null)
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
  }, [tabMenu])

  const contextTab = tabMenu ? workspaceTabs.find((tab) => tab.id === tabMenu.tabId) ?? null : null
  const contextTabIndex = contextTab
    ? workspaceTabs.findIndex((tab) => tab.id === contextTab.id)
    : -1

  const openQuickSwitchTab = (tab: WorkspaceTab) => {
    setActiveTab(tab.id)
    setQuickSwitchOpen(false)
    setQuickSwitchQuery('')
    setQuickSwitchIndex(0)
  }

  if (!activeTab || rightView.kind === 'empty') {
    return (
      <div className="flex-1 flex items-center justify-center bg-background px-6 text-center">
        <div className="flex max-w-sm flex-col items-center gap-2">
          <TableIcon className="h-8 w-8 text-muted-foreground/70" />
          <div className="text-sm font-medium text-foreground">{t('workspace.emptyTitle')}</div>
          <div className="text-xs leading-5 text-muted-foreground">{t('workspace.selectTablePrompt')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div
        role="tablist"
        aria-label={t('workspace.tabList')}
        className="flex h-[53px] items-center gap-1 overflow-x-auto border-b border-border bg-card/95 px-2"
      >
        {workspaceTabs.map((tab) => {
          const active = tab.id === activeTab.id
          const title = getTabDisplayTitle(tab.view, t)
          return (
            <div
              key={tab.id}
              draggable
              onMouseDown={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                closeTab(tab.id)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                setTabMenu({
                  x: Math.min(event.clientX, window.innerWidth - 216),
                  y: Math.min(event.clientY, window.innerHeight - 184),
                  tabId: tab.id
                })
              }}
              onDragStart={(event) => {
                setDraggedTabId(tab.id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', tab.id)
              }}
              onDragEnter={() => {
                if (draggedTabId && draggedTabId !== tab.id) setDragOverTabId(tab.id)
              }}
              onDragOver={(event) => {
                if (!draggedTabId || draggedTabId === tab.id) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDragOverTabId(tab.id)
              }}
              onDrop={(event) => {
                event.preventDefault()
                const sourceTabId = draggedTabId ?? event.dataTransfer.getData('text/plain')
                if (sourceTabId && sourceTabId !== tab.id) moveTab(sourceTabId, tab.id)
                setDraggedTabId(null)
                setDragOverTabId(null)
              }}
              onDragEnd={() => {
                setDraggedTabId(null)
                setDragOverTabId(null)
              }}
              className={cn(
                'group flex h-9 min-w-0 shrink-0 items-center gap-1 rounded-md border px-2 text-sm transition-colors',
                active
                  ? 'border-primary/35 bg-accent text-foreground shadow-sm'
                  : 'border-transparent text-muted-foreground hover:bg-accent/70 hover:text-foreground',
                draggedTabId === tab.id && 'opacity-60',
                dragOverTabId === tab.id && 'ring-1 ring-ring'
              )}
            >
              <button
                ref={(element) => {
                  if (element) {
                    tabButtonRefs.current[tab.id] = element
                  } else {
                    delete tabButtonRefs.current[tab.id]
                  }
                }}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                title={title}
                className="flex h-8 min-w-0 items-center gap-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.view.kind === 'diff' || tab.view.kind === 'table-compare' ? (
                  <GitCompareArrows className="h-3.5 w-3.5 shrink-0" />
                ) : tab.view.kind === 'database' ? (
                  <DatabaseIcon className="h-3.5 w-3.5 shrink-0" />
                ) : tab.view.kind === 'sql' ? (
                  <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                ) : tab.view.kind === 'database-export' ? (
                  <Download className="h-3.5 w-3.5 shrink-0" />
                ) : tab.view.kind === 'ssh-editor' ? (
                  <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                ) : tab.view.kind === 'ssh-terminal' ? (
                  <SquareTerminal className="h-3.5 w-3.5 shrink-0" />
                ) : tab.view.kind === 'ssh-files' ? (
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <TableIcon className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="max-w-52 truncate">{title}</span>
              </button>
              <button
                type="button"
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded transition-opacity hover:bg-background/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                )}
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(tab.id)
                }}
                title={t('workspace.closeTab')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>

      {tabMenu && contextTab && (
        <div className="fixed inset-0 z-[75]" onClick={() => setTabMenu(null)}>
          <div
            role="menu"
            className="absolute w-52 rounded-md border border-border bg-card p-1 text-sm shadow-xl"
            style={{ left: tabMenu.x, top: tabMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <TabMenuItem
              label={t('workspace.tabMenu.close')}
              onClick={() => {
                closeTab(contextTab.id)
                setTabMenu(null)
              }}
            />
            <TabMenuItem
              label={t('workspace.tabMenu.closeOthers')}
              disabled={workspaceTabs.length <= 1}
              onClick={() => {
                closeOtherTabs(contextTab.id)
                setTabMenu(null)
              }}
            />
            <TabMenuItem
              label={t('workspace.tabMenu.closeRight')}
              disabled={contextTabIndex < 0 || contextTabIndex >= workspaceTabs.length - 1}
              onClick={() => {
                closeTabsToRight(contextTab.id)
                setTabMenu(null)
              }}
            />
            <div className="my-1 h-px bg-border" />
            <TabMenuItem
              label={t('workspace.tabMenu.closeAll')}
              onClick={() => {
                closeAllTabs()
                setTabMenu(null)
              }}
            />
          </div>
        </div>
      )}

      {quickSwitchOpen && (
        <div className="fixed inset-0 z-[85] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm">
          <div
            className="w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={t('workspace.quickSwitchTitle')}
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                ref={quickSwitchInputRef}
                value={quickSwitchQuery}
                onChange={(event) => setQuickSwitchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setQuickSwitchOpen(false)
                    return
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setQuickSwitchIndex((current) =>
                      quickSwitchMatches.length === 0 ? 0 : (current + 1) % quickSwitchMatches.length
                    )
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setQuickSwitchIndex((current) =>
                      quickSwitchMatches.length === 0
                        ? 0
                        : (current - 1 + quickSwitchMatches.length) % quickSwitchMatches.length
                    )
                    return
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    const match = quickSwitchMatches[quickSwitchIndex]
                    if (match) openQuickSwitchTab(match.tab)
                  }
                }}
                placeholder={t('workspace.quickSwitchPlaceholder')}
                className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setQuickSwitchOpen(false)}
                title={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[50vh] overflow-auto p-1">
              {quickSwitchMatches.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {t('workspace.noTabsMatch')}
                </div>
              ) : (
                quickSwitchMatches.map(({ tab, title }, index) => {
                  const active = tab.id === activeTab.id
                  const focused = index === quickSwitchIndex
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm',
                        focused && 'bg-accent text-foreground',
                        !focused && 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
                      )}
                      onMouseEnter={() => setQuickSwitchIndex(index)}
                      onClick={() => openQuickSwitchTab(tab)}
                    >
                      {tab.view.kind === 'diff' || tab.view.kind === 'table-compare' ? (
                        <GitCompareArrows className="h-4 w-4 shrink-0" />
                      ) : tab.view.kind === 'database' ? (
                        <DatabaseIcon className="h-4 w-4 shrink-0" />
                      ) : tab.view.kind === 'sql' || tab.view.kind === 'ssh-editor' ? (
                        <FileCode2 className="h-4 w-4 shrink-0" />
                      ) : tab.view.kind === 'ssh-terminal' ? (
                        <SquareTerminal className="h-4 w-4 shrink-0" />
                      ) : tab.view.kind === 'database-export' ? (
                        <Download className="h-4 w-4 shrink-0" />
                      ) : tab.view.kind === 'ssh-files' ? (
                        <Folder className="h-4 w-4 shrink-0" />
                      ) : (
                        <TableIcon className="h-4 w-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{title}</span>
                      {active && <span className="text-[10px] text-muted-foreground">{t('workspace.activeTab')}</span>}
                    </button>
                  )
                })
              )}
            </div>
            <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              {t('workspace.quickSwitchHint')}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {workspaceTabs.map((tab) => {
          const active = tab.id === activeTab.id
          const isRedisTable = tab.view.kind === 'table' && tab.view.engine === 'redis'
          const currentTableTab = isRedisTable && tableTabs[tab.id] === 'structure'
            ? 'data'
            : tableTabs[tab.id] ?? 'data'

          return (
            <div
              key={tab.id}
              className={cn('h-full min-h-0 flex-col overflow-hidden', active ? 'flex' : 'hidden')}
            >
              {tab.view.kind === 'diff' ? (
                <DiffPanel />
              ) : tab.view.kind === 'table-compare' ? (
                <TableCompareView
                  compareSessionId={tab.view.compareSessionId}
                  sourceConnectionId={tab.view.sourceConnectionId}
                  sourceDatabase={tab.view.sourceDatabase}
                  targetConnectionId={tab.view.targetConnectionId}
                  targetDatabase={tab.view.targetDatabase}
                  table={tab.view.table}
                  comparedTables={tab.view.comparedTables}
                  diffTables={tab.view.diffTables}
                />
              ) : tab.view.kind === 'sql' ? (
                <SQLQueryView
                  connectionId={tab.view.connectionId}
                  connectionName={tab.view.connectionName}
                  database={tab.view.database}
                  engine={tab.view.engine}
                />
              ) : tab.view.kind === 'database-export' ? (
                <DatabaseExportTaskView
                  taskId={tab.view.exportTaskId}
                  connectionName={tab.view.connectionName}
                  request={tab.view.request}
                />
              ) : tab.view.kind === 'ssh-files' ? (
                <SSHFileManager connectionId={tab.view.connectionId} connectionName={tab.view.connectionName} />
              ) : tab.view.kind === 'ssh-terminal' ? (
                <SSHTerminalView
                  connectionId={tab.view.connectionId}
                  connectionName={tab.view.connectionName}
                  active={active}
                />
              ) : tab.view.kind === 'ssh-editor' ? (
                <SSHFileEditor
                  connectionId={tab.view.connectionId}
                  connectionName={tab.view.connectionName}
                  remotePath={tab.view.path}
                />
              ) : tab.view.kind === 'database' ? (
                <>
                  <div className="border-b border-border bg-card/80 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate">
                        {tab.view.connectionName && (
                          <span className="text-muted-foreground">{tab.view.connectionName}</span>
                        )}
                        {tab.view.connectionName && <span className="mx-1 text-muted-foreground">/</span>}
                        <strong>{tab.view.database}</strong>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => closeTab(tab.id)}
                        title={t('workspace.closeTab')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <DatabaseInfoView
                      connectionId={tab.view.connectionId}
                      database={tab.view.database}
                      readOnly={tab.view.engine === 'redis'}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="border-b border-border bg-card/80 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate">
                        <span className="text-muted-foreground">{tab.view.database}</span>
                        <span className="mx-1 text-muted-foreground">/</span>
                        <strong>{tab.view.table}</strong>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => closeTab(tab.id)}
                        title={t('workspace.closeTab')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <Tabs
                    value={currentTableTab}
                    onValueChange={(value) =>
                      isTableTabKind(value) &&
                      setTableTabs((current) => ({
                        ...current,
                        [tab.id]: value
                      }))
                    }
                    items={
                      isRedisTable
                        ? [
                            { value: 'data', label: t('common.data') },
                            { value: 'info', label: t('common.info') }
                          ]
                        : [
                            { value: 'data', label: t('common.data') },
                            { value: 'structure', label: t('common.structure') },
                            { value: 'info', label: t('common.info') }
                          ]
                    }
                  />
                  <div className="flex-1 overflow-hidden">
                    {currentTableTab === 'data' ? (
                      <TableDataView
                        connectionId={tab.view.connectionId}
                        database={tab.view.database}
                        table={tab.view.table}
                        readOnly={isRedisTable}
                        filterEnabled={!isRedisTable}
                        sortable={!isRedisTable}
                      />
                    ) : currentTableTab === 'info' ? (
                      <TableInfoView
                        connectionId={tab.view.connectionId}
                        database={tab.view.database}
                        table={tab.view.table}
                        readOnly={isRedisTable}
                      />
                    ) : (
                      <TableStructureView
                        connectionId={tab.view.connectionId}
                        database={tab.view.database}
                        table={tab.view.table}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TabMenuItem({
  label,
  disabled,
  onClick
}: {
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className="flex w-full items-center rounded px-2 py-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      onClick={onClick}
    >
      {label}
    </button>
  )
}
