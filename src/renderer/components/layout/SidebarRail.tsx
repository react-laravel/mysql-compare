// The 44px icon rail the sidebar collapses to (`⌘\`, DESIGN-SYSTEM §9 rule 4).
//
// Blueprint risk 7: a rail that shows nothing but a chevron makes collapsing
// disorienting, so it keeps one engine icon per connection with the active one
// marked by the same 2px accent bar rows use elsewhere. Clicking a connection
// expands the sidebar back onto that node.
//
// The expanded tree itself is rebuilt in Chunk 6; this rail only needs the
// connection list, which `Sidebar` already keeps in `connection-store`.
import { GitCompareArrows, PanelLeft, Search, Settings } from 'lucide-react'
import { EngineIcon } from '@renderer/components/icons/EngineIcon'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/i18n'
import { runAppAction } from '@renderer/lib/app-actions'
import { getViewContext } from '@renderer/lib/tab-presentation'
import { cn } from '@renderer/lib/utils'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'
import { useShell } from './shell-context'

export function SidebarRail() {
  const { t } = useI18n()
  const shell = useShell()
  const connections = useConnectionStore((state) => state.connections)
  const rightView = useUIStore((state) => state.rightView)
  const setRightView = useUIStore((state) => state.setRightView)
  const setCollapsed = useSidebarStore((state) => state.setCollapsed)

  const activeConnectionId = getViewContext(rightView)?.connectionId ?? null

  const expand = () => setCollapsed(false)

  return (
    <nav
      aria-label={t('sidebar.railLabel')}
      className="flex w-[44px] shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-1"
    >
      <IconButton
        icon={Search}
        label={t('sidebar.expandAndSearch')}
        shortcut="Mod+Shift+F"
        size="sm"
        variant="ghost"
        tooltipSide="right"
        onClick={() => {
          expand()
          requestAnimationFrame(() => runAppAction('focus-sidebar-search'))
        }}
      />

      <div className="my-1 h-px w-6 bg-border" />

      <ul className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto">
        {connections.map((connection) => {
          const active = connection.id === activeConnectionId
          return (
            <li key={connection.id} className="relative">
              {active ? (
                <span
                  aria-hidden
                  className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-accent"
                />
              ) : null}
              <Tooltip side="right" content={connection.name}>
                <button
                  type="button"
                  aria-label={connection.name}
                  aria-current={active || undefined}
                  onClick={expand}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-md',
                    active ? 'bg-selected' : 'hover:bg-hover'
                  )}
                >
                  <EngineIcon engine={connection.engine} className="size-4" />
                </button>
              </Tooltip>
            </li>
          )
        })}
      </ul>

      <IconButton
        icon={GitCompareArrows}
        label={t('app.diffSync')}
        shortcut="Mod+D"
        size="sm"
        variant="ghost"
        tooltipSide="right"
        onClick={() => setRightView({ kind: 'diff' })}
      />
      <IconButton
        icon={Settings}
        label={t('titlebar.settings')}
        shortcut="Mod+,"
        size="sm"
        variant="ghost"
        tooltipSide="right"
        onClick={() => shell.openSettings()}
      />
      <IconButton
        icon={PanelLeft}
        label={t('sidebar.expandSidebar')}
        shortcut="Mod+\"
        size="sm"
        variant="ghost"
        tooltipSide="right"
        onClick={expand}
      />
    </nav>
  )
}
