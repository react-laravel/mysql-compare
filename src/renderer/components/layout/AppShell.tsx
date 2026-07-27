// The shell (blueprint §1.1).
//
// `App.tsx` used to be `<div class="flex h-screen"><Sidebar/><Workspace/></div>`
// with no titlebar, no status bar and no Settings — which is why every global
// concern had been squeezed into the sidebar's 53px header (§0.2). The regions
// are now explicit and each one has an owner:
//
//   titlebar   36px  app identity, global actions, Settings
//   sidebar    resizable / 44px rail   the object navigator
//   workspace  flex-1                  the open documents
//   statusbar  24px  global background jobs, context
//
// Every level is `overflow-hidden` so each scroll belongs to a named region
// (DESIGN-SYSTEM §2, "one scroll container per region").
import { Sidebar } from '@renderer/components/layout/Sidebar'
import { SettingsDialog } from '@renderer/components/settings/SettingsDialog'
import { useGlobalShortcuts } from '@renderer/hooks/useGlobalShortcuts'
import { cn } from '@renderer/lib/utils'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { Workspace } from '@renderer/pages/Workspace'
import { AppCommandPalette } from './AppCommandPalette'
import { AppStatusBar } from './AppStatusBar'
import { AppTitlebar } from './AppTitlebar'
import { ShellProvider } from './shell-context'
import { ShortcutHelpDialog } from './ShortcutHelpDialog'
import { SidebarRail } from './SidebarRail'

export function AppShell() {
  return (
    <ShellProvider>
      <AppShellLayout />
    </ShellProvider>
  )
}

function AppShellLayout() {
  const collapsed = useSidebarStore((state) => state.collapsed)
  useGlobalShortcuts()

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-fg">
      <AppTitlebar />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {collapsed ? <SidebarRail /> : null}
        {/*
          The sidebar stays mounted while collapsed: it owns the connection
          refresh and every sidebar dialog (which portal to the body, so they
          still work from the rail and from Settings).
        */}
        <div className={cn('flex min-h-0', collapsed && 'hidden')}>
          <Sidebar />
        </div>
        <Workspace />
      </div>

      <AppStatusBar />

      <AppCommandPalette />
      <SettingsDialog />
      <ShortcutHelpDialog />
    </div>
  )
}
