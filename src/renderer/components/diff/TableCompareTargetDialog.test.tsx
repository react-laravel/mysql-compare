// @vitest-environment jsdom
//
// Blueprint §2.4: the table row's `⋯` → "Compare with…" is the second entrance
// to the table compare, and it must land on the *same* tab id the diff panel's
// "Open compare" produces.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { createSidebarActions } from '@renderer/components/layout/sidebar-actions'
import { buildTableMenuItems } from '@renderer/components/layout/sidebar-menus'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'
import type { AppAPI } from '../../../shared/app-api'
import type { SafeConnection } from '../../../shared/types'
import { TableCompareTargetDialog } from './TableCompareTargetDialog'
import { buildTableCompareSessionId } from './table-compare-session'

const SOURCE: SafeConnection = {
  id: 'c1',
  name: 'prod',
  engine: 'mysql',
  host: 'h',
  port: 3306,
  username: 'u',
  database: 'shop'
} as unknown as SafeConnection

const TARGET: SafeConnection = { ...SOURCE, id: 'c2', name: 'staging' }
const REDIS: SafeConnection = { ...SOURCE, id: 'c3', name: 'cache', engine: 'redis' }

const listDatabases = vi.fn()
const t = (key: string) => key

afterEach(cleanup)

beforeEach(() => {
  useI18nStore.getState().setLocale('en')
  useConnectionStore.setState({ connections: [SOURCE, TARGET, REDIS] })
  useUIStore.setState({ workspaceTabs: [], activeTabId: null, rightView: { kind: 'empty' } })
  useSidebarStore.getState().setTableCompareTargetDialog(null)
  listDatabases.mockReset().mockResolvedValue({ ok: true, data: ['shop', 'shop_staging'] })
  ;(window as unknown as { api: AppAPI }).api = {
    db: { listDatabases }
  } as unknown as AppAPI
})

describe('the "Compare with…" entrance', () => {
  it('is on the table row menu for SQL engines and absent for Redis keys', () => {
    const actions = createSidebarActions(t as never)
    const ids = (connection: SafeConnection) =>
      buildTableMenuItems({ connection, database: 'shop', table: 'orders', t: t as never, actions })
        .flatMap((item) => ('id' in item ? [item.id] : []))

    expect(ids(SOURCE)).toContain('compare-with')
    expect(ids(REDIS)).not.toContain('compare-with')
  })

  it('opens the target picker from the menu item', () => {
    const actions = createSidebarActions(t as never)
    actions.compareTableWith(SOURCE, 'shop', 'orders')

    expect(useSidebarStore.getState().tableCompareTargetDialog).toEqual({
      connection: SOURCE,
      database: 'shop',
      table: 'orders'
    })
  })
})

describe('TableCompareTargetDialog', () => {
  beforeEach(() => {
    useSidebarStore.getState().setTableCompareTargetDialog({
      connection: SOURCE,
      database: 'shop',
      table: 'orders'
    })
  })

  it('refuses the source endpoint as its own target', async () => {
    render(<TableCompareTargetDialog />)
    await waitFor(() => expect(listDatabases).toHaveBeenCalledWith('c1'))

    const [, database] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(database!, { target: { value: 'shop' } })

    expect(screen.getByRole('button', { name: 'Compare' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Pick a different database — this is the source itself.')).toBeTruthy()
  })

  it('opens a table-compare tab whose id matches the diff panel entrance', async () => {
    render(<TableCompareTargetDialog />)
    await waitFor(() => expect(listDatabases).toHaveBeenCalledWith('c1'))

    const [connection] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(connection!, { target: { value: 'c2' } })
    await waitFor(() => expect(listDatabases).toHaveBeenCalledWith('c2'))

    const [, database] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(database!, { target: { value: 'shop_staging' } })
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }))

    const expectedId = buildTableCompareSessionId({
      sourceConnectionId: 'c1',
      sourceDatabase: 'shop',
      targetConnectionId: 'c2',
      targetDatabase: 'shop_staging',
      table: 'orders'
    })

    const state = useUIStore.getState()
    expect(state.activeTabId).toBe(`table-compare:${expectedId}`)
    expect(state.rightView).toMatchObject({
      kind: 'table-compare',
      sourceConnectionId: 'c1',
      targetDatabase: 'shop_staging',
      table: 'orders',
      comparedTables: ['orders'],
      diffTables: []
    })
    expect(useSidebarStore.getState().tableCompareTargetDialog).toBeNull()
  })

  it('never offers a Redis connection as a compare endpoint', async () => {
    render(<TableCompareTargetDialog />)

    const [connection] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const offered = Array.from(connection!.options, (option) => option.textContent)
    expect(offered).toContain('staging')
    expect(offered).not.toContain('cache')
  })
})
