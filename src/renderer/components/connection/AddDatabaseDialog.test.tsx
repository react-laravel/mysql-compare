// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useI18nStore } from '@renderer/i18n'
import type { SafeConnection } from '../../../shared/types'
import { AddDatabaseDialog } from './AddDatabaseDialog'

const { discover, testCredential, addDatabase } = vi.hoisted(() => ({
  discover: vi.fn(), testCredential: vi.fn(), addDatabase: vi.fn()
}))
vi.mock('@renderer/lib/api', () => ({
  api: { db: { discoverDatabases: discover }, connection: { testDatabaseCredential: testCredential } },
  unwrap: async <T,>(value: Promise<T> | T): Promise<T> => await value
}))
vi.mock('../layout/sidebar-actions', () => ({ useSidebarActions: () => ({ addDatabase }) }))

const connection: SafeConnection = {
  id: 'pg', name: 'Server', engine: 'postgres', username: 'owner', database: 'app',
  databases: ['reports'], databaseCredentials: { private: { username: 'private_user', hasPassword: true } },
  host: 'localhost', port: 5432, useSSH: false, createdAt: 1, updatedAt: 1,
  hasPassword: true, hasSSHPassword: false, hasSSHPrivateKey: false
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const nameInput = () => screen.getByRole('textbox', { name: 'Database name' }) as HTMLInputElement
const enterName = (name: string) => fireEvent.change(nameInput(), { target: { value: name } })
const submit = () => fireEvent.submit(nameInput().closest('form')!)

beforeEach(() => {
  vi.clearAllMocks()
  useI18nStore.getState().setLocale('en')
  useConnectionStore.setState({ connections: [connection] })
  useSidebarStore.setState({ addDatabaseConnection: connection })
  discover.mockResolvedValue([])
  testCredential.mockResolvedValue({ message: 'Connected' })
  addDatabase.mockResolvedValue(undefined)
})
afterEach(cleanup)

it('focuses the name and submits manually entered names without discovery', async () => {
  render(<AddDatabaseDialog />)
  expect(document.activeElement).toBe(nameInput())
  expect(screen.queryByLabelText('Password')).toBeNull()
  expect(discover).not.toHaveBeenCalled()
  enterName('  chat  ')
  const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
  expect(save.type).toBe('submit')
  expect(save.form).toBe(nameInput().closest('form'))
  submit()
  await waitFor(() => expect(addDatabase).toHaveBeenCalledWith(connection, 'chat', {}))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('focuses the first invalid field and clears test feedback after editing credentials', async () => {
  render(<AddDatabaseDialog />)
  submit()
  expect(screen.getByRole('alert').textContent).toBe('Enter a database name')
  expect(document.activeElement).toBe(nameInput())
  expect(addDatabase).not.toHaveBeenCalled()
  enterName('chat')
  fireEvent.click(screen.getByRole('radio', { name: 'Use another account' }))
  submit()
  expect(document.activeElement).toBe(screen.getByLabelText('Username'))
  expect(screen.getByRole('alert').textContent).toBe('Database username is required')
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'chat_user' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'first' } })
  fireEvent.click(screen.getByRole('button', { name: 'Test' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Connected'))
  expect(testCredential).toHaveBeenCalledWith('pg', 'chat', { username: 'chat_user', password: 'first' })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'changed' } })
  expect(screen.queryByText('Connected')).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: 'Use connection account (owner)' }))
  expect(screen.queryByLabelText('Password')).toBeNull()
  submit()
  await waitFor(() => expect(addDatabase).toHaveBeenCalledWith(connection, 'chat', {}))
})

it('shows selectable discovery results and marks every configured database as already added', async () => {
  discover.mockResolvedValue(['chat', 'app', 'reports', 'private', 'chat'])
  render(<AddDatabaseDialog />)
  fireEvent.click(screen.getByRole('button', { name: 'Discover' }))
  const choices = await screen.findByRole('list', { name: 'Discovered databases' })
  expect(within(choices).getAllByRole('button')).toHaveLength(4)
  for (const name of ['app', 'reports', 'private']) {
    expect((within(choices).getByRole('button', { name: `${name} Added` }) as HTMLButtonElement).disabled).toBe(true)
  }
  fireEvent.click(within(choices).getByRole('button', { name: 'chat' }))
  expect(nameInput().value).toBe('chat')
  expect(document.activeElement).toBe(nameInput())
  expect(addDatabase).not.toHaveBeenCalled()
})

it.each(['app', 'reports', 'private'])('prevents manually re-adding %s from replacing saved credentials', (name) => {
  render(<AddDatabaseDialog />)
  enterName(name)
  expect(screen.getByRole('alert').textContent).toContain('already added')
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  submit()
  expect(addDatabase).not.toHaveBeenCalled()
  expect(testCredential).not.toHaveBeenCalled()
})

it('keeps manual entry available after discovery returns no databases', async () => {
  render(<AddDatabaseDialog />)
  fireEvent.click(screen.getByRole('button', { name: 'Discover' }))
  await screen.findByText('No databases discovered. You can still enter a name manually.')
  enterName('hidden_database')
  submit()
  await waitFor(() => expect(addDatabase).toHaveBeenCalledWith(connection, 'hidden_database', {}))
})

it('keeps loading on the active operation and discards test results after closing and reopening', async () => {
  const pending = deferred<{ message: string }>()
  testCredential.mockReturnValue(pending.promise)
  render(<AddDatabaseDialog />)
  enterName('chat')
  fireEvent.click(screen.getByRole('radio', { name: 'Use another account' }))
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'custom' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('button', { name: 'Test' }))
  expect(screen.getByRole('button', { name: 'Testing…' }).getAttribute('aria-busy')).toBe('true')
  expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-busy')).toBeNull()
  submit()
  expect(testCredential).toHaveBeenCalledTimes(1)
  expect(addDatabase).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  act(() => useSidebarStore.getState().setAddDatabaseConnection(connection))
  expect(nameInput().value).toBe('')
  expect(screen.queryByLabelText('Password')).toBeNull()
  await act(async () => pending.resolve({ message: 'Old connection result' }))
  expect(screen.queryByText('Old connection result')).toBeNull()
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('radio', { name: 'Use another account' }))
  expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
})

it('does not apply discovery results to a newly opened connection dialog', async () => {
  const pending = deferred<string[]>()
  discover.mockReturnValue(pending.promise)
  render(<AddDatabaseDialog />)
  fireEvent.click(screen.getByRole('button', { name: 'Discover' }))
  expect(screen.getByRole('button', { name: 'Discovering…' }).getAttribute('aria-busy')).toBe('true')
  expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-busy')).toBeNull()
  act(() => useSidebarStore.getState().setAddDatabaseConnection({ ...connection, id: 'other', name: 'Other server' }))
  await act(async () => pending.resolve(['stale_database']))
  expect(screen.queryByRole('list', { name: 'Discovered databases' })).toBeNull()
  expect(screen.getByRole('dialog').textContent).toContain('Other server')
})

it('prevents duplicate saves, preserves failed input, and allows retry', async () => {
  const pending = deferred<void>()
  addDatabase.mockReturnValueOnce(pending.promise)
  render(<AddDatabaseDialog />)
  enterName('chat')
  submit()
  submit()
  expect(addDatabase).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Saving…' }).getAttribute('aria-busy')).toBe('true')
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => pending.reject(new Error('Connection interrupted')))
  expect(screen.getByRole('alert').textContent).toBe('Connection interrupted')
  expect(nameInput().value).toBe('chat')
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(addDatabase).toHaveBeenCalledTimes(2)
})
