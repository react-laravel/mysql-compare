// The documented shortcut table (DESIGN-SYSTEM §8.1, blueprint §4).
//
// This is the *description* of the bindings; `useGlobalShortcuts` is the
// implementation. They are kept apart on purpose: matching a real
// `KeyboardEvent` needs `PageUp`, `Tab`, digits and platform modifiers, which a
// chord string cannot express without a parser nobody else needs. The help
// sheet and the command palette both read this list, so a binding that exists
// is always discoverable.
export type ShortcutGroupId = 'global' | 'tabs' | 'view'

export interface ShortcutEntry {
  id: string
  /** `Kbd` chord strings — `Mod` renders ⌘ on mac and Ctrl elsewhere. */
  chords: string[]
  /** i18n key under `shortcuts.keys` */
  labelKey: string
  group: ShortcutGroupId
}

export const SHORTCUT_GROUPS: ShortcutGroupId[] = ['global', 'tabs', 'view']

export const SHORTCUTS: ShortcutEntry[] = [
  { id: 'palette', chords: ['Mod+K'], labelKey: 'commandPalette', group: 'global' },
  { id: 'help', chords: ['?'], labelKey: 'shortcutHelp', group: 'global' },
  { id: 'settings', chords: ['Mod+,'], labelKey: 'settings', group: 'global' },
  { id: 'diff', chords: ['Mod+D'], labelKey: 'diffSync', group: 'global' },
  { id: 'new-connection', chords: ['Mod+N'], labelKey: 'newConnection', group: 'global' },
  { id: 'new-sql', chords: ['Mod+Shift+N'], labelKey: 'newSqlConsole', group: 'global' },
  { id: 'toggle-sidebar', chords: ['Mod+\\'], labelKey: 'toggleSidebar', group: 'global' },
  { id: 'sidebar-search', chords: ['Mod+Shift+F'], labelKey: 'focusSidebarSearch', group: 'global' },

  { id: 'close-tab', chords: ['Mod+W'], labelKey: 'closeTab', group: 'tabs' },
  { id: 'jump-tab', chords: ['Mod+1'], labelKey: 'jumpToTab', group: 'tabs' },
  { id: 'next-tab', chords: ['Ctrl+Tab', 'Alt+Right'], labelKey: 'nextTab', group: 'tabs' },
  { id: 'prev-tab', chords: ['Ctrl+Shift+Tab', 'Alt+Left'], labelKey: 'prevTab', group: 'tabs' },

  { id: 'focus-filter', chords: ['Mod+F'], labelKey: 'focusFilter', group: 'view' },
  { id: 'refresh', chords: ['Mod+R'], labelKey: 'refreshView', group: 'view' },
  { id: 'cancel', chords: ['Mod+.'], labelKey: 'cancelJob', group: 'view' },
  { id: 'save', chords: ['Mod+S'], labelKey: 'save', group: 'view' },
  { id: 'bottom-panel', chords: ['Mod+J'], labelKey: 'toggleBottomPanel', group: 'view' },
  { id: 'run-sql', chords: ['Mod+Enter'], labelKey: 'runSql', group: 'view' },
  { id: 'dismiss', chords: ['Esc'], labelKey: 'dismiss', group: 'view' }
]
