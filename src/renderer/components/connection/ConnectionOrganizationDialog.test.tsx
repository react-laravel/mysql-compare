// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useI18nStore } from '@renderer/i18n'
import type { SafeConnection } from '../../../shared/types'
import { ConnectionOrganizationDialog } from './ConnectionOrganizationDialog'
import { connectionHostGroup } from './connection-organization'
import { groupConnections } from '../layout/sidebar-tree-rows'

const { organize } = vi.hoisted(() => ({ organize: vi.fn() }))
vi.mock('@renderer/lib/api', () => ({
  api: { connection: { organize } },
  unwrap: async <T,>(value: Promise<T> | T): Promise<T> => await value
}))

function connection(id: string, fields: Partial<SafeConnection> = {}): SafeConnection {
  return { id, name: id, engine: 'postgres', host: '127.0.0.1', port: 5432, username: 'app',
    database: id, useSSH: false, createdAt: 1, updatedAt: 1,
    hasPassword: true, hasSSHPassword: false, hasSSHPrivateKey: false, ...fields }
}
const first = connection('zeta', { useSSH: true, sshHost: 'prod.example' })
const second = connection('alpha', { useSSH: true, sshHost: 'prod.example', engine: 'mysql', port: 3306 })
const third = connection('local')

beforeEach(() => {
  useI18nStore.getState().setLocale('en')
  useConnectionStore.setState({ connections: [first, second, third] })
  useSidebarStore.setState({ organizingConnections: true })
  organize.mockReset()
  organize.mockImplementation(async (items) => items.map((item: { id: string; group?: string }) => ({
    ...[first, second, third].find((entry) => entry.id === item.id), group: item.group
  })))
})
afterEach(cleanup)

describe('connection host groups', () => {
  it('groups databases and engines on the same SSH host, while separating unrelated loopbacks', () => {
    expect(connectionHostGroup(first)).toBe(connectionHostGroup(second))
    expect(connectionHostGroup(first)).not.toBe(connectionHostGroup(third))
    expect(connectionHostGroup(first)).not.toBe(connectionHostGroup({ ...first, sshHost: 'other.example' }))
    expect(connectionHostGroup(first)).not.toBe(connectionHostGroup({ ...first, sshPort: 2222 }))
    expect(connectionHostGroup(first)).not.toBe(connectionHostGroup({ ...first, host: 'db.internal' }))
    expect(connectionHostGroup({ ...third, host: 'LOCALHOST' })).toBe(connectionHostGroup(third))
  })

  it('does not merge a custom group named like the fallback key into ungrouped connections', () => {
    expect(groupConnections([first, { ...second, group: '__ungrouped' }], 'Ungrouped')).toHaveLength(2)
  })
})

describe('ConnectionOrganizationDialog', () => {
  it('saves host groups and manual connection and group order as metadata only', async () => {
    render(<ConnectionOrganizationDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Group by host' }))
    expect(within(screen.getByRole('region', { name: 'prod.example' })).getAllByRole('combobox')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Move connection up · alpha · mysql · alpha' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move group up · 127.0.0.1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(useSidebarStore.getState().organizingConnections).toBe(false))
    expect(organize).toHaveBeenCalledWith([
      { id: 'local', group: '127.0.0.1' }, { id: 'alpha', group: 'prod.example' }, { id: 'zeta', group: 'prod.example' }
    ])
    expect(useConnectionStore.getState().connections.map((entry) => entry.id)).toEqual(['local', 'alpha', 'zeta'])
  })

  it('supports custom groups, sorting and cancelling without changing saved connections', () => {
    render(<ConnectionOrganizationDialog />)
    const input = screen.getByRole('combobox', { name: 'Group · zeta · postgres · zeta' })
    fireEvent.change(input, { target: { value: 'Production' } })
    expect(input.isConnected).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))
    expect(screen.getByRole('region', { name: 'Production' })).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Ungrouped' })).getAllByRole('combobox').map((input) => input.getAttribute('aria-label')))
      .toEqual(['Group · alpha · mysql · alpha', 'Group · local · postgres · local'])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(organize).not.toHaveBeenCalled()
    expect(useConnectionStore.getState().connections).toEqual([first, second, third])
  })

  it('keeps the draft open and preserves saved data when persistence fails', async () => {
    organize.mockRejectedValue(new Error('disk full'))
    render(<ConnectionOrganizationDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Group by host' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'disk full')
    expect(useSidebarStore.getState().organizingConnections).toBe(true)
    expect(useConnectionStore.getState().connections).toEqual([first, second, third])
  })

  it('saves newly typed group names without requiring blur or a sort first', async () => {
    render(<ConnectionOrganizationDialog />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Group · zeta · postgres · zeta' }), { target: { value: 'Projects' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Group · local · postgres · local' }), { target: { value: 'Projects' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(organize).toHaveBeenCalledWith([
      { id: 'zeta', group: 'Projects' }, { id: 'local', group: 'Projects' }, { id: 'alpha', group: undefined }
    ]))
  })
})
