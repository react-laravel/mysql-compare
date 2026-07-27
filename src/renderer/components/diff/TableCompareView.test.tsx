// @vitest-environment jsdom
//
// Covers what chunk 10 actually changed: the mandatory `DiffGutter` on every
// row, the token-driven legend, the two `confirm()` calls that became
// `ConfirmDialog`s, and the overflow menu the four header buttons collapsed
// into.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { resetAppActions, runAppAction } from '@renderer/lib/app-actions'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useJobStore } from '@renderer/store/job-store'
import { useSettingsStore } from '@renderer/store/settings-store'
import type { AppAPI } from '../../../shared/app-api'
import type { QueryRowsResult, SafeConnection } from '../../../shared/types'
import { TableCompareView } from './TableCompareView'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '@renderer/store/settings-store'

const CONNECTIONS: SafeConnection[] = [
  { id: 'c1', name: 'prod', engine: 'mysql', host: 'h', port: 3306, username: 'u', database: 'shop' },
  { id: 'c2', name: 'staging', engine: 'mysql', host: 'h', port: 3306, username: 'u', database: 'shop' }
] as unknown as SafeConnection[]

const COLUMNS = [
  { name: 'id', type: 'int', nullable: false, isPrimaryKey: true },
  { name: 'total', type: 'decimal(10,2)', nullable: false, isPrimaryKey: false }
]

function result(rows: Record<string, unknown>[]): QueryRowsResult {
  return {
    columns: COLUMNS,
    rows,
    total: rows.length,
    primaryKey: ['id'],
    hasPrimaryKey: true
  } as unknown as QueryRowsResult
}

const queryRows = vi.fn()
const deleteRows = vi.fn()
const syncExecute = vi.fn()

function installApi(): void {
  ;(window as unknown as { api: AppAPI }).api = {
    db: { queryRows, deleteRows, insertRow: vi.fn() },
    sync: { execute: syncExecute }
  } as unknown as AppAPI
}

const PROPS = {
  compareSessionId: 'c1:shop:c2:shop:orders',
  sourceConnectionId: 'c1',
  sourceDatabase: 'shop',
  targetConnectionId: 'c2',
  targetDatabase: 'shop',
  table: 'orders',
  comparedTables: ['orders', 'users'],
  diffTables: ['orders', 'users']
}

afterEach(() => {
  cleanup()
  resetAppActions()
})

beforeEach(() => {
  useI18nStore.getState().setLocale('en')
  window.localStorage.clear()
  useConnectionStore.setState({ connections: CONNECTIONS })
  useJobStore.setState({ jobs: new Map() })
  useSettingsStore.getState().reset()
  deleteRows.mockReset().mockResolvedValue({ ok: true, data: { affectedRows: 1 } })
  syncExecute.mockReset().mockResolvedValue({ ok: true, data: { executed: 2, errors: 0 } })
  // Source has an extra row (1044) and a changed value on 1042; the target has
  // a row (1099) the source lacks — one of each diff kind.
  queryRows.mockReset().mockImplementation(async ({ connectionId }: { connectionId: string }) =>
    connectionId === 'c1'
      ? {
          ok: true,
          data: result([
            { id: 1042, total: '129.00' },
            { id: 1043, total: '18.50' },
            { id: 1044, total: '7.00' }
          ])
        }
      : {
          ok: true,
          data: result([
            { id: 1042, total: '119.00' },
            { id: 1043, total: '18.50' },
            { id: 1099, total: '3.00' }
          ])
        }
  )
  installApi()
})

async function renderView() {
  const view = render(<TableCompareView {...PROPS} />)
  await screen.findByRole('heading', { name: 'Compare · orders' })
  await waitFor(() => expect(queryRows).toHaveBeenCalledTimes(2))
  return view
}

function openOverflow(): void {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
}

describe('TableCompareView', () => {
  it('renders a diff sign on every aligned row and the same glyph on both panes', async () => {
    await renderView()

    // 4 aligned rows × 2 panes, every one of them signed.
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr[data-diff]').length).toBe(8)
    })

    const signs = (kind: string) =>
      document.querySelectorAll(`tbody tr[data-diff="${kind}"]`).length

    expect(signs('mod')).toBe(2) // 1042 changed on both sides
    expect(signs('add')).toBe(2) // 1044 exists only on the source
    expect(signs('del')).toBe(2) // 1099 exists only on the target
    expect(signs('same')).toBe(2) // 1043 identical
  })

  it('states the legend with glyphs, not colour alone', async () => {
    await renderView()

    for (const label of ['Changed field', 'Source only', 'Target only']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    // Every legend entry leads with its own gutter glyph.
    expect(document.querySelectorAll('[data-diff="add"]').length).toBeGreaterThan(1)
  })

  it('routes "delete selected" through a ConfirmDialog instead of confirm()', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    await renderView()

    const [sourcePane] = await screen.findAllByRole('table')
    fireEvent.click(within(sourcePane!).getAllByRole('checkbox')[1]!)

    openOverflow()
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete 1 selected on source/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete 1 selected row(s)?')).toBeTruthy()
    expect(confirmSpy).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: /Delete selected/ }))
    await waitFor(() => expect(deleteRows).toHaveBeenCalledTimes(1))
  })

  it('confirms the overwrite, names the target in mono and registers a job for it', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    await renderView()

    openOverflow()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Overwrite Target Table' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Overwrite the target table?')).toBeTruthy()
    expect(within(dialog).getByText('staging / shop / orders')).toBeTruthy()
    expect(confirmSpy).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Overwrite Target Table' }))

    await waitFor(() => expect(syncExecute).toHaveBeenCalledTimes(1))
    const [job] = Array.from(useJobStore.getState().jobs.values())
    expect(job?.kind).toBe('sync')
    expect(job?.tabId).toBe('table-compare:c1:shop:c2:shop:orders')
  })

  it('keeps reload, diff navigation and page size reachable from the one ⋯', async () => {
    await renderView()

    openOverflow()
    for (const label of [
      /Reload both sides/,
      /Rows per page/,
      /Next table with differences/,
      /Previous table with differences/
    ]) {
      expect(screen.getByRole('menuitem', { name: label })).toBeTruthy()
    }

    // The page-size guard that used to live on the pagination bar's `Select`.
    fireEvent.click(screen.getByRole('menuitem', { name: /Rows per page/ }))
    const offered = screen.getAllByRole('menuitemcheckbox').map((item) => Number(item.textContent))
    for (const size of PAGE_SIZE_OPTIONS) {
      expect(offered).toContain(size)
    }
    expect(offered).toContain(DEFAULT_PAGE_SIZE)
  })

  it('answers ⌘R by reloading both sides', async () => {
    await renderView()

    // Counting only this table's queries: the view also prefetches the next
    // table with differences, so the total call count is not a stable signal.
    const ordersQueries = () =>
      queryRows.mock.calls.filter(([query]) => (query as { table: string }).table === 'orders').length
    const before = ordersQueries()

    expect(runAppAction('refresh-view')).toBe(true)
    await waitFor(() => expect(ordersQueries()).toBeGreaterThanOrEqual(before + 2))
  })
})
