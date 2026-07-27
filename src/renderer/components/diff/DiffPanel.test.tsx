// @vitest-environment jsdom
//
// Covers what Chunk 9 actually changed: the toolbar's Compare/Cancel pair, the
// job the compare registers (which is what the status bar and `⌘.` read), the
// "Compare this database…" prefill, and the concurrency migration out of the
// diff panel's own localStorage blob.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { resetAppActions } from '@renderer/lib/app-actions'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useJobStore } from '@renderer/store/job-store'
import { useSettingsStore } from '@renderer/store/settings-store'
import { useUIStore } from '@renderer/store/ui-store'
import type { AppAPI } from '../../../shared/app-api'
import type { SafeConnection, TableComparisonResult } from '../../../shared/types'
import { DiffPanel } from './DiffPanel'
import { DIFF_PANEL_PREFERENCES_KEY } from './diff-panel-utils'
import { migrateStoredCompareConcurrency } from './diff-panel-hooks'

const CONNECTIONS: SafeConnection[] = [
  { id: 'c1', name: 'prod', engine: 'mysql', host: 'h', port: 3306, username: 'u', database: 'shop' },
  { id: 'c2', name: 'staging', engine: 'mysql', host: 'h', port: 3306, username: 'u', database: 'shop' }
] as unknown as SafeConnection[]

const listDatabases = vi.fn()
const listTables = vi.fn()
const diffTable = vi.fn()

function installApi(): void {
  ;(window as unknown as { api: AppAPI }).api = {
    connection: { list: async () => ({ ok: true, data: CONNECTIONS }) },
    db: { listDatabases, listTables },
    diff: { table: diffTable }
  } as unknown as AppAPI
}

/** A compare that never settles, so the running state can be inspected. */
function pendingComparison(): Promise<never> {
  return new Promise<never>(() => {})
}

afterEach(() => {
  cleanup()
  resetAppActions()
})

beforeEach(() => {
  useI18nStore.getState().setLocale('en')
  window.localStorage.clear()
  useConnectionStore.setState({ connections: [] })
  useJobStore.setState({ jobs: new Map() })
  useUIStore.setState({ latestDiffPrefillRequest: null })
  useSettingsStore.getState().reset()
  listDatabases.mockReset().mockResolvedValue({ ok: true, data: ['shop'] })
  listTables.mockReset().mockResolvedValue({ ok: true, data: ['orders'] })
  diffTable.mockReset().mockImplementation(pendingComparison)
  installApi()
})

async function renderPanel() {
  const view = render(<DiffPanel />)
  await screen.findByRole('heading', { name: 'Diff & Sync' })
  return view
}

function openOverflow(): void {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
}

describe('DiffPanel', () => {
  it('renders a toolbar with Compare and an idle empty state that offers the same action', async () => {
    await renderPanel()

    expect(screen.getAllByRole('button', { name: 'Compare' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Nothing compared yet')).toBeTruthy()
    // Plan Sync is present but explains itself instead of being a dead control.
    expect(screen.getByRole('button', { name: 'Plan Sync' }).hasAttribute('disabled')).toBe(true)
  })

  it('offers Cancel while comparing, registers a job for it and keeps partial results', async () => {
    await renderPanel()

    act(() => {
      useUIStore.getState().requestDiffCompare('c1', 'shop')
    })
    // The prefill only fills the source; pick a target the same way a user would.
    const [, targetConnection] = screen.getAllByLabelText('Connection') as HTMLSelectElement[]
    fireEvent.change(targetConnection!, { target: { value: 'c2' } })
    await waitFor(() => expect(listDatabases).toHaveBeenCalledWith('c2'))
    const [, targetDatabase] = screen.getAllByLabelText('Database') as HTMLSelectElement[]
    fireEvent.change(targetDatabase!, { target: { value: 'shop' } })

    fireEvent.click(screen.getAllByRole('button', { name: 'Compare' })[0]!)

    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    await waitFor(() => {
      expect(Array.from(useJobStore.getState().jobs.values()).some((job) => job.kind === 'compare'))
        .toBe(true)
    })

    fireEvent.click(cancel)

    await waitFor(() => {
      const [job] = Array.from(useJobStore.getState().jobs.values())
      expect(job?.status).toBe('cancelled')
    })
    // Partial results survive: the result tabs are still on screen.
    expect(screen.getByRole('tab', { name: /Status/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('prefills the source endpoint from a database row and expands setup', async () => {
    await renderPanel()

    act(() => {
      useUIStore.getState().requestDiffCompare('c1', 'shop')
    })

    await waitFor(() => {
      const [sourceConnection] = screen.getAllByLabelText('Connection') as HTMLSelectElement[]
      expect(sourceConnection!.value).toBe('c1')
    })
    expect(screen.getByRole('button', { name: /Hide/ })).toBeTruthy()
  })

  it('drives "Compare rows" from settings-store through the overflow menu', async () => {
    await renderPanel()
    expect(useSettingsStore.getState().compareRows).toBe(true)

    openOverflow()
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Compare rows' }))

    expect(useSettingsStore.getState().compareRows).toBe(false)
  })
})

describe('migrateStoredCompareConcurrency', () => {
  it('lifts a stored non-default value into settings once', () => {
    window.localStorage.setItem(
      DIFF_PANEL_PREFERENCES_KEY,
      JSON.stringify({ tableCompareConcurrency: 20 })
    )

    migrateStoredCompareConcurrency()

    expect(useSettingsStore.getState().tableCompareConcurrency).toBe(20)
  })

  it('never overwrites a value the user already chose in Settings', () => {
    useSettingsStore.getState().setTableCompareConcurrency(50)
    window.localStorage.setItem(
      DIFF_PANEL_PREFERENCES_KEY,
      JSON.stringify({ tableCompareConcurrency: 1 })
    )

    migrateStoredCompareConcurrency()

    expect(useSettingsStore.getState().tableCompareConcurrency).toBe(50)
  })
})
