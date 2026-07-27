// The command registry behind ⌘K (blueprint §3.10).
//
// This is the contract that makes the IA curation non-lossy (DESIGN-SYSTEM §9
// rule 1): anything demoted out of a primary surface registers a command here,
// so it is still one keystroke away. It also replaces the old quick switcher,
// which could only *switch between* already-open tabs and returned early when
// none were open (`Workspace.tsx:154`) — open tabs are now just the first
// section of a palette that can also open things.
import { useMemo } from 'react'
import {
  Columns3,
  Download,
  Folder,
  GitCompareArrows,
  Keyboard,
  Languages,
  Moon,
  PanelLeft,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Square,
  SquareTerminal,
  Sun,
  Table as TableIcon,
  WrapText,
  X
} from 'lucide-react'
import type { Command } from '@renderer/components/ui/command-palette'
import { useI18n, LOCALES } from '@renderer/i18n'
import { runAppAction, hasAppAction } from '@renderer/lib/app-actions'
import { getTabDisplayTitle, getTabIcon, getViewContext } from '@renderer/lib/tab-presentation'
import { useConnectionStore } from '@renderer/store/connection-store'
import { isJobActive, useJobStore } from '@renderer/store/job-store'
import { useSettingsStore } from '@renderer/store/settings-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'
import { useTheme } from '@renderer/theme'
import { useShell } from './shell-context'
import { useSidebarActions } from './sidebar-actions'

export function useCommands(): Command[] {
  const { t, locale, setLocale } = useI18n()
  const shell = useShell()
  const { theme, setTheme } = useTheme()

  const workspaceTabs = useUIStore((state) => state.workspaceTabs)
  const activeTabId = useUIStore((state) => state.activeTabId)
  const rightView = useUIStore((state) => state.rightView)
  const setActiveTab = useUIStore((state) => state.setActiveTab)
  const setRightView = useUIStore((state) => state.setRightView)
  const closeTab = useUIStore((state) => state.closeTab)
  const closeAllTabs = useUIStore((state) => state.closeAllTabs)
  const refreshTableData = useUIStore((state) => state.refreshTableData)

  const connections = useConnectionStore((state) => state.connections)
  const jobMap = useJobStore((state) => state.jobs)
  const cancelJob = useJobStore((state) => state.cancel)

  const setCreating = useSidebarStore((state) => state.setCreating)
  const toggleCollapsed = useSidebarStore((state) => state.toggleCollapsed)
  const collapsed = useSidebarStore((state) => state.collapsed)

  const settings = useSettingsStore()
  const sidebarActions = useSidebarActions()

  return useMemo(() => {
    const context = getViewContext(rightView)
    const activeJobs = Array.from(jobMap.values()).filter(isJobActive)
    // §3.10 "Compare table orders with…" — the palette entrance to the table
    // compare, alongside the table row's `⋯`.
    const compareTable =
      rightView.kind === 'table' && rightView.engine !== 'redis'
        ? {
            connection: connections.find((item) => item.id === rightView.connectionId),
            database: rightView.database,
            table: rightView.table
          }
        : null

    const navigate: Command[] = [
      {
        id: 'nav.diff',
        group: 'navigate',
        title: t('palette.commands.openDiffSync'),
        keywords: 'diff sync compare 对比 同步 差异',
        icon: GitCompareArrows,
        shortcut: 'Mod+D',
        perform: () => setRightView({ kind: 'diff' })
      },
      {
        id: 'nav.settings',
        group: 'navigate',
        title: t('palette.commands.openSettings'),
        keywords: 'settings preferences 设置 偏好',
        icon: Settings,
        shortcut: 'Mod+,',
        perform: () => shell.openSettings()
      },
      {
        id: 'nav.shortcuts',
        group: 'navigate',
        title: t('palette.commands.openShortcuts'),
        keywords: 'keyboard shortcuts help 快捷键 帮助',
        icon: Keyboard,
        shortcut: '?',
        perform: () => shell.openShortcutHelp()
      },
      {
        id: 'nav.sidebar',
        group: 'navigate',
        title: collapsed ? t('palette.commands.expandSidebar') : t('palette.commands.collapseSidebar'),
        keywords: 'sidebar collapse expand 侧边栏 折叠',
        icon: PanelLeft,
        shortcut: 'Mod+\\',
        perform: toggleCollapsed
      }
    ]

    const actions: Command[] = [
      {
        id: 'action.new-connection',
        group: 'action',
        title: t('palette.commands.newConnection'),
        keywords: 'new connection server 新建 连接',
        icon: Plus,
        shortcut: 'Mod+N',
        perform: () => setCreating(true)
      },
      {
        id: 'action.new-sql',
        group: 'action',
        title: t('palette.commands.newSqlConsole'),
        keywords: 'sql console query 新建 控制台 查询',
        icon: Play,
        shortcut: 'Mod+Shift+N',
        disabled: !context,
        disabledReason: t('titlebar.needsDatabase'),
        perform: () => {
          if (!context) return
          setRightView({
            kind: 'sql',
            connectionId: context.connectionId,
            connectionName: context.connectionName,
            database: context.database,
            engine: context.engine
          })
        }
      },
      {
        id: 'action.refresh',
        group: 'action',
        title: t('palette.commands.refreshView'),
        keywords: 'refresh reload rerun 刷新 重载',
        icon: RefreshCw,
        shortcut: 'Mod+R',
        disabled: !hasAppAction('refresh-view') && rightView.kind !== 'table',
        disabledReason: t('palette.commands.refreshUnavailable'),
        perform: () => {
          if (runAppAction('refresh-view')) return
          if (rightView.kind === 'table') {
            refreshTableData(rightView.connectionId, rightView.database, rightView.table)
          }
        }
      },
      {
        id: 'action.save',
        group: 'action',
        title: t('palette.commands.saveCurrent'),
        keywords: 'save write file 保存 写入',
        icon: Save,
        shortcut: 'Mod+S',
        disabled: !hasAppAction('save'),
        disabledReason: t('palette.commands.saveUnavailable'),
        perform: () => {
          runAppAction('save')
        }
      },
      {
        id: 'action.compare-table',
        group: 'action',
        title: t('palette.commands.compareTableWith', {
          table: compareTable?.table ?? t('common.data')
        }),
        keywords: 'compare table side by side 对比 表',
        icon: GitCompareArrows,
        disabled: !compareTable?.connection,
        disabledReason: t('palette.commands.needsTableTab'),
        perform: () => {
          if (!compareTable?.connection) return
          sidebarActions.compareTableWith(
            compareTable.connection,
            compareTable.database,
            compareTable.table
          )
        }
      },
      {
        id: 'action.columns',
        group: 'action',
        title: t('palette.commands.chooseColumns'),
        keywords: 'columns hide show 列 显示 隐藏',
        icon: Columns3,
        disabled: !hasAppAction('open-column-picker'),
        disabledReason: t('palette.commands.needsTableTab'),
        perform: () => {
          runAppAction('open-column-picker')
        }
      },
      {
        id: 'action.export',
        group: 'action',
        title: t('palette.commands.exportTable'),
        keywords: 'export csv sql json 导出',
        icon: Download,
        disabled: !hasAppAction('export-current-view'),
        disabledReason: t('palette.commands.needsTableTab'),
        perform: () => {
          runAppAction('export-current-view')
        }
      },
      {
        id: 'action.close-tab',
        group: 'action',
        title: t('palette.commands.closeTab'),
        keywords: 'close tab 关闭 标签',
        icon: X,
        shortcut: 'Mod+W',
        disabled: !activeTabId,
        disabledReason: t('palette.commands.noTabOpen'),
        perform: () => {
          if (activeTabId) closeTab(activeTabId)
        }
      },
      {
        id: 'action.close-all-tabs',
        group: 'action',
        title: t('palette.commands.closeAllTabs'),
        keywords: 'close all tabs 关闭 全部 标签',
        icon: X,
        disabled: workspaceTabs.length === 0,
        disabledReason: t('palette.commands.noTabOpen'),
        perform: closeAllTabs
      },
      ...activeJobs.map<Command>((job) => ({
        id: `action.cancel.${job.id}`,
        group: 'action',
        title: t('palette.commands.cancelJob', { job: String(job.label) }),
        keywords: 'cancel stop job 取消 停止 任务',
        icon: Square,
        shortcut: job.tabId && job.tabId === activeTabId ? 'Mod+.' : undefined,
        perform: () => cancelJob(job.id)
      }))
    ]

    const open: Command[] = [
      ...workspaceTabs.map<Command>((tab) => ({
        id: `open.tab.${tab.id}`,
        group: 'open',
        title: getTabDisplayTitle(tab.view, t),
        keywords: `${tab.id} tab 标签`,
        icon: getTabIcon(tab.view),
        hint: tab.id === activeTabId ? t('workspace.activeTab') : t('palette.openTab'),
        // Most-recently-active first when the query is empty.
        recentAt: tab.id === activeTabId ? Date.now() : undefined,
        perform: () => setActiveTab(tab.id)
      })),
      ...connections
        .filter((connection) => connection.useSSH)
        .flatMap<Command>((connection) => [
          {
            id: `open.ssh-files.${connection.id}`,
            group: 'open',
            title: t('palette.commands.openSshFiles', { connection: connection.name }),
            keywords: 'ssh sftp files 文件',
            icon: Folder,
            perform: () =>
              setRightView({
                kind: 'ssh-files',
                connectionId: connection.id,
                connectionName: connection.name
              })
          },
          {
            id: `open.ssh-terminal.${connection.id}`,
            group: 'open',
            title: t('palette.commands.openSshTerminal', { connection: connection.name }),
            keywords: 'ssh terminal shell 终端',
            icon: SquareTerminal,
            perform: () =>
              setRightView({
                kind: 'ssh-terminal',
                connectionId: connection.id,
                connectionName: connection.name
              })
          }
        ]),
      ...connections.map<Command>((connection) => ({
        id: `open.database-tab.${connection.id}`,
        group: 'open',
        title: t('palette.commands.openDatabaseInfo', { connection: connection.name }),
        keywords: `${connection.engine} database 数据库`,
        icon: TableIcon,
        hint: connection.database || undefined,
        disabled: !connection.database,
        disabledReason: t('palette.commands.noDefaultDatabase'),
        perform: () => {
          if (!connection.database) return
          setRightView({
            kind: 'database',
            connectionId: connection.id,
            connectionName: connection.name,
            database: connection.database,
            engine: connection.engine
          })
        }
      }))
    ]

    // Every control demoted out of a toolbar in §1.3 lands here.
    const settingsCommands: Command[] = [
      {
        id: 'settings.theme',
        group: 'settings',
        title: theme === 'dark' ? t('titlebar.useLightTheme') : t('titlebar.useDarkTheme'),
        keywords: 'theme dark light appearance 主题 深色 浅色',
        icon: theme === 'dark' ? Sun : Moon,
        perform: () => setTheme(theme === 'dark' ? 'light' : 'dark')
      },
      ...LOCALES.filter((option) => option.code !== locale).map<Command>((option) => ({
        id: `settings.locale.${option.code}`,
        group: 'settings',
        title: t('palette.commands.setLanguage', { language: option.label }),
        keywords: 'language locale 语言',
        icon: Languages,
        perform: () => setLocale(option.code)
      })),
      {
        id: 'settings.wrap',
        group: 'settings',
        title: settings.wrapCells
          ? t('palette.commands.disableWrap')
          : t('palette.commands.enableWrap'),
        keywords: 'wrap cells lines 换行 单元格',
        icon: WrapText,
        perform: () => settings.setWrapCells(!settings.wrapCells)
      },
      {
        id: 'settings.density',
        group: 'settings',
        title:
          settings.density === 'compact'
            ? t('palette.commands.useComfortableDensity')
            : t('palette.commands.useCompactDensity'),
        keywords: 'density compact comfortable 密度 紧凑 宽松',
        icon: Settings,
        perform: () =>
          settings.setDensity(settings.density === 'compact' ? 'comfortable' : 'compact')
      },
      {
        id: 'settings.colorblind',
        group: 'settings',
        title: settings.colorblindDiff
          ? t('palette.commands.disableColorblindDiff')
          : t('palette.commands.enableColorblindDiff'),
        keywords: 'colorblind diff colours 色盲 差异 颜色',
        icon: GitCompareArrows,
        perform: () => settings.setColorblindDiff(!settings.colorblindDiff)
      },
      {
        id: 'settings.compare-rows',
        group: 'settings',
        title: settings.compareRows
          ? t('palette.commands.disableCompareRows')
          : t('palette.commands.enableCompareRows'),
        keywords: 'compare rows diff data 对比 行 数据',
        icon: GitCompareArrows,
        perform: () => settings.setCompareRows(!settings.compareRows)
      },
      {
        id: 'settings.grid-defaults',
        group: 'settings',
        title: t('palette.commands.openGridSettings'),
        keywords: 'grid page size columns 网格 分页 列',
        icon: Settings,
        perform: () => shell.openSettings('grid')
      },
      {
        id: 'settings.diff-defaults',
        group: 'settings',
        title: t('palette.commands.openDiffSettings'),
        keywords: 'diff sync concurrency workers 并发 同步',
        icon: Settings,
        perform: () => shell.openSettings('diff')
      },
      {
        id: 'settings.data',
        group: 'settings',
        title: t('palette.commands.openDataSettings'),
        keywords: 'data storage history clear 数据 历史 清理',
        icon: Settings,
        perform: () => shell.openSettings('data')
      }
    ]

    return [...navigate, ...actions, ...open, ...settingsCommands]
  }, [
    activeTabId,
    cancelJob,
    closeAllTabs,
    closeTab,
    collapsed,
    connections,
    jobMap,
    locale,
    refreshTableData,
    rightView,
    setActiveTab,
    setCreating,
    setLocale,
    setRightView,
    setTheme,
    settings,
    shell,
    sidebarActions,
    t,
    theme,
    toggleCollapsed,
    workspaceTabs
  ])
}
