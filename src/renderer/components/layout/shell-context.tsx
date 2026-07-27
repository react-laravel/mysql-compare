// The three app-level overlays the shell owns: the command palette, Settings
// and the shortcut-help sheet.
//
// They are context rather than a store because they are pure view state with a
// single owner (`AppShell`), and because every consumer — the titlebar, the
// status bar, `useGlobalShortcuts`, the command registry and (later chunks) the
// workspace empty state — is already inside that shell.
import * as React from 'react'

export type SettingsSectionId =
  | 'appearance'
  | 'language'
  | 'connections'
  | 'grid'
  | 'diff'
  | 'data'

export interface ShellContextValue {
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void
  openCommandPalette: () => void

  settingsOpen: boolean
  settingsSection: SettingsSectionId
  setSettingsOpen: (open: boolean) => void
  openSettings: (section?: SettingsSectionId) => void

  shortcutHelpOpen: boolean
  setShortcutHelpOpen: (open: boolean) => void
  openShortcutHelp: () => void
}

const ShellContext = React.createContext<ShellContextValue | null>(null)

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [commandPaletteOpen, setCommandPaletteOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [settingsSection, setSettingsSection] = React.useState<SettingsSectionId>('appearance')
  const [shortcutHelpOpen, setShortcutHelpOpen] = React.useState(false)

  const value = React.useMemo<ShellContextValue>(
    () => ({
      commandPaletteOpen,
      setCommandPaletteOpen,
      openCommandPalette: () => setCommandPaletteOpen(true),
      settingsOpen,
      settingsSection,
      setSettingsOpen,
      openSettings: (section) => {
        if (section) setSettingsSection(section)
        setSettingsOpen(true)
      },
      shortcutHelpOpen,
      setShortcutHelpOpen,
      openShortcutHelp: () => setShortcutHelpOpen(true)
    }),
    [commandPaletteOpen, settingsOpen, settingsSection, shortcutHelpOpen]
  )

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

export function useShell(): ShellContextValue {
  const value = React.useContext(ShellContext)
  if (!value) throw new Error('useShell must be used inside <ShellProvider>')
  return value
}
