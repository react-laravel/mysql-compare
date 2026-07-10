import { create } from 'zustand'

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'mysql-compare:theme'

function getPreferredTheme(): Theme {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
}

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* ignore unavailable storage */
  }
  return getPreferredTheme()
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

function writeStoredTheme(theme: Theme): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* ignore unavailable storage */
  }
}

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    applyTheme(theme)
    writeStoredTheme(theme)
    set({ theme })
  }
}))

export function initializeTheme(): void {
  applyTheme(useThemeStore.getState().theme)
}

export function useTheme(): ThemeState {
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  return { theme, setTheme }
}
