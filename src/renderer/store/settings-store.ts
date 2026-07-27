// App-level preferences — the "set once" half of the IA.
//
// DESIGN-SYSTEM §9 rule 2: setup lives in Settings, never in the nav. This is
// where the controls demoted out of the toolbars land.
//
// THEME AND LOCALE ARE NOT DUPLICATED HERE. They already own their own
// persisted stores and the Settings screen must delegate to them:
//   theme  → `useTheme()` / `useThemeStore` (`src/renderer/theme/index.ts`)
//   locale → `useI18nStore` (`src/renderer/i18n/index.ts`)
// Two sources of truth for the theme would out-of-sync the `dark` class the
// moment either one is written directly.
import { create } from 'zustand'
import { persist, type PersistOptions } from 'zustand/middleware'
import { safeJSONStorage } from './persist'
// Single source of truth for the concurrency default and its option list —
// `DiffPanel` already persists a per-session copy under
// `mysql-compare:diff-panel-preferences`; Chunk 9 makes that copy default from
// here instead of re-declaring the number.
import {
  DEFAULT_TABLE_COMPARE_CONCURRENCY,
  TABLE_COMPARE_CONCURRENCY_OPTIONS
} from '@renderer/components/diff/diff-panel-utils'

export { DEFAULT_TABLE_COMPARE_CONCURRENCY, TABLE_COMPARE_CONCURRENCY_OPTIONS }

export const SETTINGS_STORAGE_KEY = 'mysql-compare:settings'
export const SETTINGS_STORAGE_VERSION = 1

export const COLORBLIND_DIFF_ATTRIBUTE = 'data-colorblind-diff'

export type GridDensity = 'compact' | 'comfortable'

export const GRID_DENSITIES = ['compact', 'comfortable'] as const

/**
 * The page sizes a grid can actually display. Must stay a superset of nothing
 * and a subset of the `<Select>` in `TableDataPagination.tsx:51-56`: a default
 * this store allows but that select cannot render would show "50" while the
 * query used something else. Chunk 7 rebuilds that pagination and should render
 * this constant instead of re-declaring the list.
 */
export const PAGE_SIZE_OPTIONS = [50, 100, 250, 500] as const
export const DEFAULT_PAGE_SIZE = 100

export interface SettingsState {
  /** Default row height for every data grid. Per-view overrides still win. */
  density: GridDensity
  /**
   * DESIGN-SYSTEM §1.5: the green/red diff pair fails the CVD gate in dark
   * (ΔE 5.6). This swaps it for the validated blue/orange pair.
   */
  colorblindDiff: boolean
  /** Rows per page a freshly opened table starts on. */
  defaultPageSize: number
  /** Wrap long cell values instead of truncating them. */
  wrapCells: boolean
  /** Compare row data (not only schema) when a database diff runs. */
  compareRows: boolean
  /** How many tables a database diff compares in parallel. */
  tableCompareConcurrency: number

  setDensity: (density: GridDensity) => void
  setColorblindDiff: (enabled: boolean) => void
  setDefaultPageSize: (pageSize: number) => void
  setWrapCells: (wrap: boolean) => void
  setCompareRows: (compare: boolean) => void
  setTableCompareConcurrency: (concurrency: number) => void
  reset: () => void
}

export type PersistedSettings = Omit<SettingsState, `set${string}` | 'reset'>

const DEFAULTS = {
  density: 'compact',
  colorblindDiff: false,
  defaultPageSize: DEFAULT_PAGE_SIZE,
  wrapCells: false,
  // Chunk 9 made this the single source of truth for `DiffPanel`'s "Compare
  // rows" toggle, which shipped as `useState(true)`. Defaulting to `false` here
  // would have silently turned row comparison off for everyone.
  compareRows: true,
  tableCompareConcurrency: DEFAULT_TABLE_COMPARE_CONCURRENCY
} satisfies PersistedSettings

/** One flag, one attribute on `<html>`, zero component changes. */
function applyColorblindDiff(enabled: boolean): void {
  if (typeof document === 'undefined') return
  if (enabled) {
    document.documentElement.setAttribute(COLORBLIND_DIFF_ATTRIBUTE, 'true')
  } else {
    document.documentElement.removeAttribute(COLORBLIND_DIFF_ATTRIBUTE)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function pickFrom<T extends number | string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback
}

/**
 * Persisted settings are user-editable JSON that outlives the app version that
 * wrote them, exactly like `ui-store`'s workspace payload — so nothing is
 * trusted by type. `defaultPageSize` is the one that bites: it is handed
 * straight to `db.queryRows({ pageSize })`, so a stored `"abc"` or `0` would
 * make **every** table tab fail to load with no way to recover from the UI.
 */
export function sanitizePersistedSettings(persisted: unknown): PersistedSettings {
  if (!isRecord(persisted)) return { ...DEFAULTS }

  return {
    density: pickFrom(GRID_DENSITIES, persisted.density, DEFAULTS.density),
    colorblindDiff: pickBoolean(persisted.colorblindDiff, DEFAULTS.colorblindDiff),
    defaultPageSize: pickFrom(PAGE_SIZE_OPTIONS, persisted.defaultPageSize, DEFAULTS.defaultPageSize),
    wrapCells: pickBoolean(persisted.wrapCells, DEFAULTS.wrapCells),
    compareRows: pickBoolean(persisted.compareRows, DEFAULTS.compareRows),
    tableCompareConcurrency: pickFrom(
      TABLE_COMPARE_CONCURRENCY_OPTIONS,
      persisted.tableCompareConcurrency,
      DEFAULTS.tableCompareConcurrency
    )
  }
}

const persistOptions: PersistOptions<SettingsState, PersistedSettings> = {
  name: SETTINGS_STORAGE_KEY,
  version: SETTINGS_STORAGE_VERSION,
  storage: safeJSONStorage<PersistedSettings>(),
  partialize: (state) => ({
    density: state.density,
    colorblindDiff: state.colorblindDiff,
    defaultPageSize: state.defaultPageSize,
    wrapCells: state.wrapCells,
    compareRows: state.compareRows,
    tableCompareConcurrency: state.tableCompareConcurrency
  }),
  // `migrate` covers a version bump, `merge` the normal path; the sanitizer is
  // idempotent so running through both is harmless.
  migrate: (persisted) => sanitizePersistedSettings(persisted),
  merge: (persisted, current) => ({ ...current, ...sanitizePersistedSettings(persisted) }),
  onRehydrateStorage: () => (state) => {
    if (state) applyColorblindDiff(state.colorblindDiff)
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setDensity: (density) => set({ density }),
      setColorblindDiff: (colorblindDiff) => {
        applyColorblindDiff(colorblindDiff)
        set({ colorblindDiff })
      },
      setDefaultPageSize: (defaultPageSize) => set({ defaultPageSize }),
      setWrapCells: (wrapCells) => set({ wrapCells }),
      setCompareRows: (compareRows) => set({ compareRows }),
      setTableCompareConcurrency: (tableCompareConcurrency) => set({ tableCompareConcurrency }),
      reset: () => {
        applyColorblindDiff(DEFAULTS.colorblindDiff)
        set({ ...DEFAULTS })
      }
    }),
    persistOptions
  )
)

/**
 * Applies the settings that live on `<html>`. Called from `main.tsx` next to
 * `initializeTheme()`; idempotent, so calling it again is harmless.
 */
export function initializeSettings(): void {
  applyColorblindDiff(useSettingsStore.getState().colorblindDiff)
}
