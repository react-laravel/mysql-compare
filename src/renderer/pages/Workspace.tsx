// The document region (blueprint §1.1 / §3.1).
//
// The hand-built 53px tab strip is now the shared `TabStrip` (drag reorder,
// middle-click close, roving tabIndex, one context-menu builder) at 32px, and
// the `h-9` Data/Structure/Info row is gone: those tabs are rendered *inside*
// each table view's `Toolbar`, so they cost zero vertical pixels.
import { useMemo } from 'react'
import { GitCompareArrows, Plus } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { EmptyState } from '@renderer/components/ui/empty-state'
import type { MenuItem } from '@renderer/components/ui/dropdown-menu'
import { TabStrip, type DocumentTab } from '@renderer/components/ui/tab-strip'
import { Tabs } from '@renderer/components/ui/tabs'
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
import { isTableViewTabKind, useUIStore } from '@renderer/store/ui-store'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { isJobActive, useJobStore } from '@renderer/store/job-store'
import { getTabDisplayTitle, getTabIcon } from '@renderer/lib/tab-presentation'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'

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
    moveTab,
    setRightView,
    setTableTab
  } = useUIStore()
  const { t } = useI18n()
  const connections = useConnectionStore((state) => state.connections)
  const setCreating = useSidebarStore((state) => state.setCreating)
  const jobs = useJobStore((state) => state.jobs)

  const activeTab = workspaceTabs.find((tab) => tab.id === activeTabId) ?? null

  // ⌘K / ⌘W / tab cycling now live in `useGlobalShortcuts` (mounted by
  // `AppShell`). The effect that used to be here began with
  // `if (workspaceTabs.length === 0) return`, which is why ⌘K was dead on an
  // empty workspace — exactly when a command palette is most useful.

  const tabStatus = useMemo(() => {
    const byTab = new Map<string, 'running' | 'error'>()
    for (const job of jobs.values()) {
      if (!job.tabId) continue
      if (isJobActive(job)) byTab.set(job.tabId, 'running')
      else if (job.status === 'error' && byTab.get(job.tabId) !== 'running') {
        byTab.set(job.tabId, 'error')
      }
    }
    return byTab
  }, [jobs])

  const documentTabs = useMemo<DocumentTab[]>(
    () =>
      workspaceTabs.map((tab) => ({
        id: tab.id,
        title: getTabDisplayTitle(tab.view, t),
        icon: getTabIcon(tab.view),
        status: tabStatus.get(tab.id) ?? null
      })),
    [t, tabStatus, workspaceTabs]
  )

  const tabMenu = (tabId: string): MenuItem[] => {
    const index = workspaceTabs.findIndex((tab) => tab.id === tabId)
    return [
      { id: 'close', label: t('workspace.tabMenu.close'), onSelect: () => closeTab(tabId) },
      {
        id: 'close-others',
        label: t('workspace.tabMenu.closeOthers'),
        disabled: workspaceTabs.length <= 1,
        onSelect: () => closeOtherTabs(tabId)
      },
      {
        id: 'close-right',
        label: t('workspace.tabMenu.closeRight'),
        disabled: index < 0 || index >= workspaceTabs.length - 1,
        onSelect: () => closeTabsToRight(tabId)
      },
      { kind: 'separator', id: 'sep-1' },
      { id: 'close-all', label: t('workspace.tabMenu.closeAll'), onSelect: () => closeAllTabs() }
    ]
  }

  if (!activeTab || rightView.kind === 'empty') {
    // DS §7.6: an empty state without a way out is a dead end. The old one
    // rendered prose naming a button the user could not see.
    const hasConnections = connections.length > 0
    return (
      <div className="flex flex-1 items-center justify-center overflow-hidden bg-canvas">
        <EmptyState
          variant={hasConnections ? 'no-selection' : 'first-run'}
          title={hasConnections ? t('workspace.emptyTitle') : t('workspace.firstRunTitle')}
          description={
            hasConnections ? t('workspace.selectTablePrompt') : t('workspace.firstRunDescription')
          }
          action={
            hasConnections ? (
              <Button variant="primary" icon={GitCompareArrows} onClick={() => setRightView({ kind: 'diff' })}>
                {t('app.diffSync')}
              </Button>
            ) : (
              <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                {t('sidebar.newConnection')}
              </Button>
            )
          }
          secondaryAction={
            hasConnections ? null : (
              <Button variant="secondary" icon={GitCompareArrows} onClick={() => setRightView({ kind: 'diff' })}>
                {t('app.diffSync')}
              </Button>
            )
          }
          shortcut="Mod+K"
        />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <TabStrip
        aria-label={t('workspace.tabList')}
        tabs={documentTabs}
        activeId={activeTab.id}
        closeLabel={t('workspace.closeTab')}
        onSelect={setActiveTab}
        onClose={closeTab}
        onReorder={moveTab}
        onContextMenu={tabMenu}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        {workspaceTabs.map((tab) => {
          const active = tab.id === activeTab.id
          const isRedisTable = tab.view.kind === 'table' && tab.view.engine === 'redis'
          const storedTableTab = tab.view.kind === 'table' ? tab.view.tableTab : undefined
          // Redis keys have no structure tab; a stored `structure` (e.g. from a
          // rename that used to be a SQL table) falls back to Data.
          const currentTableTab = isRedisTable && storedTableTab === 'structure'
            ? 'data'
            : storedTableTab ?? 'data'

          const tableTabs = (
            <Tabs
              variant="pill"
              size="sm"
              aria-label={t('workspace.tableTabList')}
              value={currentTableTab}
              onValueChange={(value) => {
                if (isTableViewTabKind(value)) setTableTab(tab.id, value)
              }}
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
          )

          return (
            <div
              key={tab.id}
              className={cn('h-full min-h-0 flex-col overflow-hidden', active ? 'flex' : 'hidden')}
            >
              {tab.view.kind === 'diff' ? (
                <DiffPanel active={active} />
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
                  active={active}
                />
              ) : tab.view.kind === 'sql' ? (
                <SQLQueryView
                  connectionId={tab.view.connectionId}
                  connectionName={tab.view.connectionName}
                  database={tab.view.database}
                  engine={tab.view.engine}
                  active={active}
                />
              ) : tab.view.kind === 'database-export' ? (
                <DatabaseExportTaskView
                  taskId={tab.view.exportTaskId}
                  connectionName={tab.view.connectionName}
                  request={tab.view.request}
                />
              ) : tab.view.kind === 'ssh-files' ? (
                <SSHFileManager
                  connectionId={tab.view.connectionId}
                  connectionName={tab.view.connectionName}
                  active={active}
                />
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
                  active={active}
                />
              ) : tab.view.kind === 'database' ? (
                <DatabaseInfoView
                  connectionId={tab.view.connectionId}
                  connectionName={tab.view.connectionName}
                  database={tab.view.database}
                  readOnly={tab.view.engine === 'redis'}
                  active={active}
                />
              ) : currentTableTab === 'data' ? (
                <TableDataView
                  connectionId={tab.view.connectionId}
                  database={tab.view.database}
                  table={tab.view.table}
                  engine={tab.view.engine}
                  readOnly={false}
                  filterEnabled={!isRedisTable}
                  sortable={!isRedisTable}
                  exportEnabled={!isRedisTable}
                  tabs={tableTabs}
                  active={active}
                />
              ) : currentTableTab === 'info' ? (
                <TableInfoView
                  connectionId={tab.view.connectionId}
                  database={tab.view.database}
                  table={tab.view.table}
                  readOnly={isRedisTable}
                  tabs={tableTabs}
                  active={active}
                />
              ) : (
                <TableStructureView
                  connectionId={tab.view.connectionId}
                  database={tab.view.database}
                  table={tab.view.table}
                  engine={tab.view.engine}
                  tabs={tableTabs}
                  active={active}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
