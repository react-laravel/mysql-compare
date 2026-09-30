// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useI18nStore } from '@renderer/i18n'
import type { SafeConnection } from '../../../shared/types'
import { tableKey, tableReference, tableDisplayName } from '../../../shared/table-reference'
import { configuredDatabases, showsAllDatabases } from './database-browsing'
import { AddDatabaseDialog } from './AddDatabaseDialog'
import { createSidebarActions } from '../layout/sidebar-actions'
import { SidebarTree } from '../layout/SidebarTree'

const { listTables, listSchemas, discover, update, test, listDatabases } = vi.hoisted(() => ({
  listTables: vi.fn(), listSchemas: vi.fn(), discover: vi.fn(), update: vi.fn(), test: vi.fn(), listDatabases: vi.fn()
}))
vi.mock('@renderer/lib/api', () => ({ api: {
  db: { listTables, listSchemas, discoverDatabases: discover, listDatabases },
  connection: { updateDatabaseBrowsing: update, testDatabaseCredential: test }
}, unwrap: async <T,>(value: Promise<T> | T): Promise<T> => await value }))

const connection: SafeConnection = { id: 'pg', name: 'Server', engine: 'postgres', username: 'next', database: 'next', host: 'localhost', port: 5432, useSSH: false, createdAt: 1, updatedAt: 1, hasPassword: true, hasSSHPassword: false, hasSSHPrivateKey: false }
const actions = () => createSidebarActions((key) => key)
beforeEach(() => {
  useI18nStore.getState().setLocale('en')
  useConnectionStore.setState({ connections: [connection] })
  useSidebarStore.setState({ addDatabaseConnection: null, organizingConnections: false, keyword: '', tableFilters: {}, nodes: {
    pg: { expanded: true, loading: false, databases: ['next'], tables: {}, expandedDbs: new Set(['next']) }
  } })
  for (const mock of [listTables, listSchemas, discover, update, test, listDatabases]) mock.mockReset()
  listSchemas.mockResolvedValue(['public', 'sales.v2'])
  listTables.mockResolvedValue(['words'])
  listDatabases.mockResolvedValue(['next', 'chat'])
  update.mockImplementation(async (_id, options) => ({ ...connection, databases: options.database ? [options.database] : [], showAllDatabases: options.showAll }))
  test.mockResolvedValue({ message: 'Connected' })
})
afterEach(cleanup)

it('defaults to configured PostgreSQL databases and preserves manual additions', () => {
  expect(showsAllDatabases(connection)).toBe(false)
  expect(configuredDatabases(connection)).toEqual(['next'])
  expect(configuredDatabases({ ...connection, databases: ['chat', 'next'] })).toEqual(['next', 'chat'])
  expect(showsAllDatabases({ ...connection, showAllDatabases: true })).toBe(true)
})

it('keeps schema and table identities separate even for dots and quotes', () => {
  const key = tableKey('sales.v2', 'odd".name')
  expect(tableReference(key)).toEqual({ schema: 'sales.v2', name: 'odd".name' })
  expect(tableDisplayName(key)).toBe('sales.v2.odd".name')
  expect(tableReference('sales.v2.words')).toEqual({ schema: 'public', name: 'sales.v2.words' })
})

it('adds a manually entered database with inherited credentials without an eager discovery', async () => {
  useSidebarStore.setState({ addDatabaseConnection: connection })
  render(<AddDatabaseDialog />)
  expect(discover).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('Password')).toBeNull()
  fireEvent.change(screen.getByRole('textbox', { name: 'Database name' }), { target: { value: 'chat' } })
  fireEvent.click(screen.getByRole('button', { name: 'Test' }))
  await waitFor(() => expect(test).toHaveBeenCalledWith('pg', 'chat', {}))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(update).toHaveBeenCalledWith('pg', { database: 'chat', credential: {} }))
  await waitFor(() => expect(useSidebarStore.getState().addDatabaseConnection).toBeNull())
  expect(useConnectionStore.getState().connections[0]?.database).toBe('next')
})

it('only exposes account inputs after explicitly choosing another account', async () => {
  useSidebarStore.setState({ addDatabaseConnection: connection })
  render(<AddDatabaseDialog />)
  fireEvent.click(screen.getByRole('radio', { name: 'Use another account' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Database name' }), { target: { value: 'chat' } })
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'chat_user' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-only' } })
  fireEvent.click(screen.getByRole('button', { name: 'Test' }))
  await waitFor(() => expect(test).toHaveBeenCalledWith('pg', 'chat', { username: 'chat_user', password: 'test-only' }))
})

it('shows an actionable access error instead of claiming the database is empty', async () => {
  listTables.mockRejectedValue(new Error('permission denied for table words'))
  await actions().refreshDatabase(connection, 'next')
  render(<SidebarTree />)
  expect(screen.getByText('This account does not have access')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  expect(screen.queryByText('No tables')).toBeNull()
  expect(useSidebarStore.getState().databaseCredentialDialog).toBeNull()
})

it('ignores an older schema response after a later schema is selected', async () => {
  let resolveOld!: (tables: string[]) => void
  listTables.mockImplementation((_id, _db, schema) => schema === 'public' ? new Promise((resolve) => { resolveOld = resolve }) : Promise.resolve([tableKey('sales.v2', 'words')]))
  const controller = actions()
  const oldRequest = controller.setDatabaseSchema(connection, 'next', 'public')
  await waitFor(() => expect(listTables).toHaveBeenCalledWith('pg', 'next', 'public'))
  await controller.setDatabaseSchema(connection, 'next', 'sales.v2')
  resolveOld(['old_public_table'])
  await oldRequest
  expect(useSidebarStore.getState().nodes.pg?.tables.next).toEqual([tableKey('sales.v2', 'words')])
  expect(useSidebarStore.getState().nodes.pg?.activeSchemas?.next).toBe('sales.v2')
})
