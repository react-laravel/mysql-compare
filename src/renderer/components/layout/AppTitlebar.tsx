// The 36px drag-region header (blueprint §1.1).
//
// It exists so that "things that are not about the selected object" stop being
// squeezed into the sidebar header. Chief among them: Diff & Sync, the feature
// the product is named after, whose only entry point used to be an unlabeled
// `Database` + `ChevronDown` in `SidebarAppMenu.tsx` (blueprint §0.1). It is now
// a labeled button with a shortcut.
import * as React from 'react'
import {
  Command as CommandIcon,
  GitCompareArrows,
  Info,
  Keyboard,
  Moon,
  Plus,
  Settings,
  Sun
} from 'lucide-react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { DropdownMenu, type MenuItem } from '@renderer/components/ui/dropdown-menu'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Kbd } from '@renderer/components/ui/kbd'
import { SplitButton } from '@renderer/components/ui/split-button'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/i18n'
import { api } from '@renderer/lib/api'
import { getViewContext } from '@renderer/lib/tab-presentation'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'
import { useTheme } from '@renderer/theme'
import { useShell } from './shell-context'

export function AppTitlebar() {
  const { t } = useI18n()
  const shell = useShell()
  const { theme, setTheme } = useTheme()
  const rightView = useUIStore((state) => state.rightView)
  const setRightView = useUIStore((state) => state.setRightView)
  const setCreating = useSidebarStore((state) => state.setCreating)
  const setCreateRedisKeyDialog = useSidebarStore((state) => state.setCreateRedisKeyDialog)
  const connections = useConnectionStore((state) => state.connections)
  const [aboutOpen, setAboutOpen] = React.useState(false)

  const context = getViewContext(rightView)
  const canOpenSQLConsole = Boolean(context) && rightView.kind !== 'table-compare'
  const redisConnection = context
    ? connections.find(
        (connection) => connection.id === context.connectionId && connection.engine === 'redis'
      ) ?? null
    : null

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  const appMenuItems: MenuItem[] = [
    {
      id: 'settings',
      label: t('titlebar.settings'),
      icon: Settings,
      shortcut: 'Mod+,',
      onSelect: () => shell.openSettings()
    },
    {
      id: 'shortcuts',
      label: t('titlebar.keyboardShortcuts'),
      icon: Keyboard,
      shortcut: '?',
      onSelect: () => shell.openShortcutHelp()
    },
    {
      id: 'palette',
      label: t('titlebar.commandPalette'),
      icon: CommandIcon,
      shortcut: 'Mod+K',
      onSelect: () => shell.openCommandPalette()
    },
    { kind: 'separator', id: 'sep-1' },
    {
      id: 'theme',
      label: theme === 'dark' ? t('titlebar.useLightTheme') : t('titlebar.useDarkTheme'),
      icon: theme === 'dark' ? Sun : Moon,
      onSelect: toggleTheme
    },
    {
      id: 'about',
      label: t('titlebar.about'),
      icon: Info,
      onSelect: () => setAboutOpen(true)
    }
  ]

  const newMenuItems: MenuItem[] = [
    {
      id: 'new-connection',
      label: t('titlebar.newConnection'),
      shortcut: 'Mod+N',
      onSelect: () => setCreating(true)
    },
    {
      id: 'new-sql',
      label: t('titlebar.newSqlConsole'),
      shortcut: 'Mod+Shift+N',
      disabled: !canOpenSQLConsole,
      disabledReason: t('titlebar.needsDatabase'),
      onSelect: () => {
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
      id: 'new-redis-key',
      label: t('titlebar.newRedisKey'),
      disabled: !redisConnection || !context,
      disabledReason: t('titlebar.needsRedisDatabase'),
      onSelect: () => {
        if (!redisConnection || !context) return
        // The dialog is the sidebar's; it needs the whole `SafeConnection`,
        // which only the connection store has.
        setCreateRedisKeyDialog({ connection: redisConnection, database: context.database })
      }
    }
  ]

  return (
    <header
      data-tauri-drag-region
      className="flex h-titlebar shrink-0 items-center gap-1.5 border-b border-border bg-surface px-2"
    >
      <DropdownMenu
        items={appMenuItems}
        side="bottom"
        align="start"
        aria-label={t('titlebar.appMenu')}
        trigger={
          <IconButton
            icon={CommandIcon}
            label={t('titlebar.appMenu')}
            size="sm"
            variant="ghost"
          />
        }
      />
      <span data-tauri-drag-region className="text-sm font-semibold text-fg">
        {t('app.title')}
      </span>

      <div data-tauri-drag-region className="flex-1" />

      <Tooltip
        content={
          <>
            {t('titlebar.diffSyncHint')} <Kbd>Mod+D</Kbd>
          </>
        }
      >
        <Button
          size="sm"
          variant="secondary"
          icon={GitCompareArrows}
          onClick={() => setRightView({ kind: 'diff' })}
        >
          {t('app.diffSync')}
        </Button>
      </Tooltip>

      <SplitButton
        size="sm"
        icon={Plus}
        items={newMenuItems}
        menuLabel={t('titlebar.newMenu')}
        onClick={() => setCreating(true)}
      >
        {t('titlebar.new')}
      </SplitButton>

      <IconButton
        icon={CommandIcon}
        label={t('titlebar.commandPalette')}
        shortcut="Mod+K"
        size="sm"
        variant="ghost"
        onClick={shell.openCommandPalette}
      />
      <IconButton
        icon={Settings}
        label={t('titlebar.settings')}
        shortcut="Mod+,"
        size="sm"
        variant="ghost"
        onClick={() => shell.openSettings()}
      />

      <Dialog
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        size="sm"
        title={t('titlebar.about')}
        description={t('titlebar.aboutDescription')}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-fg-muted">{t('titlebar.aboutRuntime')}</dt>
          <dd className="font-mono text-fg">{api.runtime.mode}</dd>
        </dl>
      </Dialog>
    </header>
  )
}
