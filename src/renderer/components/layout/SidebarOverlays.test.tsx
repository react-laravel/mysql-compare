// @vitest-environment jsdom
/**
 * The menus and the one confirmation surface. The point of Chunk 6 here is that
 * `sidebar-menus.ts` is the single source for a given object's actions and that
 * every destructive path — including copy-table and delete-connection, which
 * used native `confirm()` — ends in the same `ConfirmDialog`.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'
import type { SafeConnection } from '../../../shared/types'
import { SidebarOverlays } from './SidebarOverlays'

const mocks = vi.hoisted(() => ({
  truncateTable: vi.fn(),
  dropTable: vi.fn(),
  copyTable: vi.fn(),
  dropDatabase: vi.fn(),
  listTables: vi.fn(),
  getDatabaseInfo: vi.fn(),
  removeConnection: vi.fn(),
  closeConnection: vi.fn(),
  listConnections: vi.fn()
}))

vi.mock('@renderer/lib/api', () => ({
  api: {
    db: {
      truncateTable: mocks.truncateTable,
      dropTable: mocks.dropTable,
      copyTable: mocks.copyTable,
      dropDatabase: mocks.dropDatabase,
      listTables: mocks.listTables,
      getDatabaseInfo: mocks.getDatabaseInfo
    },
    connection: {
      remove: mocks.removeConnection,
      close: mocks.closeConnection,
      list: mocks.listConnections
    }
  },
  unwrap: async <T,>(value: Promise<T> | T): Promise<T> => await value
}))

const connection: SafeConnection = {
  id: 'conn-1',
  engine: 'mysql',
  name: 'Local MySQL',
  host: '127.0.0.1',
  port: 3306,
  username: 'root',
  database: 'app_db',
  useSSH: false,
  createdAt: 1,
  updatedAt: 1,
  hasPassword: true,
  hasSSHPassword: false,
  hasSSHPrivateKey: false
}

const postgresConnection: SafeConnection = {
  ...connection,
  engine: 'postgres',
  name: 'Production PostgreSQL',
  port: 5432,
  username: 'server_user'
}

const at = { x: 120, y: 80 }

function resetSidebar() {
  useSidebarStore.setState({
    creating: false,
    editing: null,
    sshSource: null,
    connectionMenu: null,
    databaseMenu: null,
    tableMenu: null,
    pendingConfirm: null,
    createSQLDialog: null,
    createRedisKeyDialog: null,
    exportDialog: null,
    exportDatabaseDialog: null,
    importDialog: null,
    databaseCredentialDialog: null,
    actionBusy: false,
    nodes: {}
  })
}

describe('SidebarOverlays', () => {
  beforeEach(() => {
    useI18nStore.getState().setLocale('en')
    useUIStore.setState({ rightView: { kind: 'empty' } })
    useConnectionStore.setState({ connections: [connection] })
    resetSidebar()
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.listTables.mockResolvedValue([])
    mocks.listConnections.mockResolvedValue([])
    mocks.truncateTable.mockResolvedValue(undefined)
    mocks.dropTable.mockResolvedValue(undefined)
    mocks.copyTable.mockResolvedValue({ table: 'users_copy' })
    mocks.dropDatabase.mockResolvedValue(undefined)
    mocks.removeConnection.mockResolvedValue(undefined)
    mocks.closeConnection.mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  it('opens table details and exposes both destructive table actions', () => {
    useSidebarStore.setState({ tableMenu: { ...at, connection, database: 'app_db', table: 'users' } })
    render(<SidebarOverlays />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Table Details' }))

    expect(useUIStore.getState().rightView).toMatchObject({
      kind: 'table',
      table: 'users',
      tableTab: 'info'
    })
  })

  it('requires confirmation before truncating, with both identity options', async () => {
    useSidebarStore.setState({ tableMenu: { ...at, connection, database: 'app_db', table: 'users' } })
    render(<SidebarOverlays />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Truncate Table' }))
    expect(mocks.truncateTable).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole('button', { name: 'Clear, Keep ID' }))
    await waitFor(() =>
      expect(mocks.truncateTable).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        database: 'app_db',
        table: 'users',
        resetIdentity: false
      })
    )

    useSidebarStore.getState().setPendingConfirm({
      kind: 'truncate-table',
      connection,
      database: 'app_db',
      table: 'users'
    })
    fireEvent.click(await screen.findByRole('button', { name: 'TRUNCATE, Reset ID' }))
    await waitFor(() =>
      expect(mocks.truncateTable).toHaveBeenLastCalledWith(
        expect.objectContaining({ resetIdentity: true })
      )
    )
  })

  it('routes copy-table through the confirm dialog instead of window.confirm', async () => {
    useSidebarStore.setState({ tableMenu: { ...at, connection, database: 'app_db', table: 'users' } })
    render(<SidebarOverlays />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy to users_copy' }))
    expect(mocks.copyTable).not.toHaveBeenCalled()

    expect(useSidebarStore.getState().pendingConfirm).toMatchObject({
      kind: 'copy-table',
      targetTable: 'users_copy'
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Copy' }))
    await waitFor(() =>
      expect(mocks.copyTable).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        database: 'app_db',
        table: 'users',
        targetTable: 'users_copy'
      })
    )
  })

  it('drops a table only after confirmation', async () => {
    useSidebarStore.setState({ tableMenu: { ...at, connection, database: 'app_db', table: 'users' } })
    render(<SidebarOverlays />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Drop Table' }))
    expect(mocks.dropTable).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole('button', { name: 'Drop Table' }))
    await waitFor(() =>
      expect(mocks.dropTable).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        database: 'app_db',
        table: 'users'
      })
    )
  })

  it('gives a database row the compare entrance and a gated drop', async () => {
    useSidebarStore.setState({
      databaseMenu: { ...at, connection: postgresConnection, database: 'app_db' }
    })
    render(<SidebarOverlays />)

    expect(screen.getByRole('menuitem', { name: 'Open SQL Console' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Database Credentials...' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Compare This Database...' }))
    expect(useUIStore.getState().rightView.kind).toBe('diff')

    useSidebarStore.getState().setDatabaseMenu({
      ...at,
      connection: postgresConnection,
      database: 'app_db'
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Drop Database...' }))

    // typed confirmation: the button stays disabled until the name matches
    const confirm = await screen.findByRole('button', { name: 'Drop Database' })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'app_db' } })
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(mocks.dropDatabase).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        database: 'app_db'
      })
    )
  })

  it('offers a PostgreSQL connection that reuses saved SSH credentials', () => {
    const sshConnection = {
      ...connection,
      useSSH: true,
      sshHost: 'server.example.com',
      sshPort: 22,
      sshUsername: 'ubuntu',
      hasSSHPrivateKey: true
    }
    useSidebarStore.setState({ connectionMenu: { ...at, connection: sshConnection } })
    render(<SidebarOverlays />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'New Connection with This SSH' }))

    expect(useSidebarStore.getState().sshSource).toEqual(sshConnection)
  })

  it('confirms before deleting a connection — it used to be a native confirm()', async () => {
    useSidebarStore.setState({ connectionMenu: { ...at, connection } })
    render(<SidebarOverlays />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Connection...' }))
    expect(mocks.removeConnection).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocks.removeConnection).toHaveBeenCalledWith('conn-1'))
  })

  it('keeps Delete out of the edit dialog footer, beside Save', () => {
    // Blueprint §1.3 / §3.11. This footer button used to be guarded by a native
    // `confirm()`; during the redesign it was rewired straight to the deleter,
    // so editing a connection could destroy it with one misclick and no prompt.
    // Delete now lives only where a `ConfirmDialog` guards it: Settings ▸
    // Connections and the connection row's `⋯`.
    useSidebarStore.setState({ editing: connection })
    render(<SidebarOverlays />)

    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('switches a database from the server account to a custom account and can test it', () => {
    useSidebarStore.setState({
      databaseCredentialDialog: { connection: postgresConnection, database: 'app_db' },
      databaseCredentialUsername: 'app_user',
      databaseCredentialUseDefault: false
    })
    render(<SidebarOverlays />)

    expect(screen.getByText('Database Access Account')).toBeTruthy()
    expect(screen.getByDisplayValue('app_user')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Server account' }))
    expect(useSidebarStore.getState().databaseCredentialUseDefault).toBe(true)
  })

  it('closes a database connection from the connection menu', async () => {
    useSidebarStore.setState({ connectionMenu: { ...at, connection } })
    render(<SidebarOverlays />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Close Database Connection' }))

    await waitFor(() => expect(useSidebarStore.getState().connectionMenu).toBeNull())
  })
})
