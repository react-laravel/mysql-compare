// @vitest-environment jsdom
/**
 * What Chunk 6 owes the sidebar: real tree semantics on *every* row (connection
 * and database rows had none), a persistent `⋯` instead of hover-gated icons,
 * and inline rename for both engines.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'
import type { SafeConnection } from '../../../shared/types'
import { SidebarTree } from './SidebarTree'
import { tableKey } from '../../../shared/table-reference'

const { renameTableMock, listTablesMock } = vi.hoisted(() => ({
  renameTableMock: vi.fn(),
  listTablesMock: vi.fn()
}))

vi.mock('@renderer/lib/api', () => ({
  api: {
    db: {
      renameTable: renameTableMock,
      listTables: listTablesMock,
      getDatabaseInfo: vi.fn()
    },
    connection: { list: vi.fn() }
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
  hasPassword: false,
  hasSSHPassword: false,
  hasSSHPrivateKey: false
}

const redisConnection: SafeConnection = {
  ...connection,
  id: 'conn-redis',
  engine: 'redis',
  name: 'Cache',
  port: 6379
}

function seed(target: SafeConnection, database: string, tables: string[]) {
  useConnectionStore.setState({ connections: [target] })
  useSidebarStore.setState({
    keyword: '',
    tableFilters: {},
    inlineRename: null,
    stickyDatabase: null,
    actionBusy: false,
    nodes: {
      [target.id]: {
        expanded: true,
        loading: false,
        databases: [database],
        tables: { [database]: tables },
        expandedDbs: new Set([database])
      }
    }
  })
}

describe('SidebarTree', () => {
  beforeEach(() => {
    useI18nStore.getState().setLocale('en')
    useUIStore.setState({ rightView: { kind: 'empty' } })
    renameTableMock.mockReset()
    renameTableMock.mockResolvedValue({ table: 'members' })
    listTablesMock.mockReset()
    listTablesMock.mockResolvedValue(['members'])
  })

  afterEach(cleanup)

  it('gives connection, database and table rows the tree semantics they lacked', () => {
    seed(connection, 'app_db', ['users'])
    render(<SidebarTree />)

    const rows = screen.getAllByRole('treeitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.getAttribute('aria-level')).toBe('1')
    expect(rows[0]?.getAttribute('aria-expanded')).toBe('true')
    expect(rows[1]?.getAttribute('aria-level')).toBe('2')
    expect(rows[2]?.getAttribute('aria-level')).toBe('3')
    // one tab stop per group — the rest are reachable with the arrow keys
    expect(rows.filter((row) => row.getAttribute('tabindex') === '0')).toHaveLength(1)
  })

  it('moves between rows with the arrow keys', () => {
    seed(connection, 'app_db', ['users'])
    render(<SidebarTree />)

    const rows = screen.getAllByRole('treeitem')
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])

    fireEvent.keyDown(rows[1]!, { key: 'ArrowLeft' })
    // the database was expanded, so ← collapses it rather than jumping up
    expect(useSidebarStore.getState().nodes['conn-1']?.expandedDbs.has('app_db')).toBe(false)
  })

  it('keeps keyboard actions on embedded buttons from also navigating or toggling the tree', () => {
    seed(connection, 'app_db', ['users'])
    render(<SidebarTree />)
    const databaseRow = screen.getAllByRole('treeitem')[1]!
    const refresh = within(databaseRow).getByRole('button', { name: 'Refresh' })
    act(() => refresh.focus())
    fireEvent.keyDown(refresh, { key: 'ArrowDown' })
    fireEvent.keyDown(refresh, { key: 'Enter' })
    expect(document.activeElement).toBe(refresh)
    expect(useSidebarStore.getState().nodes['conn-1']?.expandedDbs.has('app_db')).toBe(true)

    const menu = screen.getByRole('button', { name: 'Actions for Local MySQL' })
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(useSidebarStore.getState().nodes['conn-1']?.expanded).toBe(true)
  })

  it('keeps the same active row when preceding rows arrive during a refresh', () => {
    seed(connection, 'app_db', ['users'])
    render(<SidebarTree />)
    const users = screen.getByText('users').closest('[role="treeitem"]') as HTMLElement
    act(() => users.focus())
    act(() => useSidebarStore.setState(({ nodes }) => ({ nodes: {
      ...nodes, 'conn-1': { ...nodes['conn-1']!, tables: { app_db: ['orders', 'users'] } }
    } })))
    expect(document.activeElement).toBe(users)
    expect(users.tabIndex).toBe(0)
    expect(screen.getAllByRole('treeitem').filter((row) => row.tabIndex === 0)).toEqual([users])
  })

  it('returns focus to the database when a focused table disappears', () => {
    seed(connection, 'app_db', ['users'])
    render(<SidebarTree />)
    const database = screen.getAllByRole('treeitem')[1]!
    act(() => (screen.getByText('users').closest('[role="treeitem"]') as HTMLElement).focus())
    act(() => useSidebarStore.setState(({ nodes }) => ({ nodes: {
      ...nodes, 'conn-1': { ...nodes['conn-1']!, tables: { app_db: [] } }
    } })))
    expect(document.activeElement).toBe(database)
    expect(database.tabIndex).toBe(0)
  })

  it('does not jump to another connection when ArrowRight has no child to enter', () => {
    seed(connection, 'app_db', [])
    useConnectionStore.setState({ connections: [connection, redisConnection] })
    render(<SidebarTree />)
    const database = screen.getAllByRole('treeitem')[1]!
    act(() => database.focus())
    fireEvent.keyDown(database, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(database)
  })

  it('shows which database a schema selector belongs to and keeps its keys local', () => {
    const pg = { ...connection, engine: 'postgres' as const }
    seed(pg, 'app_db', [tableKey('sales', 'users')])
    useSidebarStore.setState(({ nodes }) => ({ nodes: {
      ...nodes, 'conn-1': { ...nodes['conn-1']!, schemas: { app_db: ['public', 'sales'] }, activeSchemas: { app_db: 'sales' } }
    } }))
    render(<SidebarTree />)
    const schema = screen.getByRole('combobox', { name: 'Schema for app_db' }) as HTMLSelectElement
    expect(screen.getByText('Schema')).toBeTruthy()
    expect(schema.value).toBe('sales')
    act(() => schema.focus())
    fireEvent.keyDown(schema, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(schema)
    expect(useSidebarStore.getState().nodes['conn-1']?.expandedDbs.has('app_db')).toBe(true)
    const database = screen.getAllByRole('treeitem')[1]!
    act(() => database.focus())
    fireEvent.keyDown(database, { key: 'u' })
    expect(document.activeElement).toBe(screen.getByText('users').closest('[role="treeitem"]'))
  })

  it('filters connections by host while keeping focus in the search field', () => {
    seed(connection, 'app_db', ['users'])
    render(<SidebarTree />)
    const search = screen.getByRole('searchbox', { name: 'Search connections by name, host, account or group' })
    act(() => search.focus())
    fireEvent.change(search, { target: { value: '127.0.0.1' } })
    expect(screen.getAllByRole('treeitem')).toHaveLength(3)
    expect(document.activeElement).toBe(search)
  })

  it('retries a database loading error in place and replaces it with the refreshed tables', async () => {
    seed(connection, 'app_db', ['users'])
    useSidebarStore.setState(({ nodes }) => ({ nodes: {
      ...nodes, 'conn-1': { ...nodes['conn-1']!, databaseErrors: { app_db: 'permission denied' } }
    } }))
    render(<SidebarTree />)
    const error = screen.getByRole('alert', { name: 'app_db' })
    expect(within(error).getByText('This account does not have access')).toBeTruthy()
    expect(screen.queryByText('users')).toBeNull()
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('members')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(listTablesMock).toHaveBeenCalledWith('conn-1', 'app_db', undefined)
  })

  it('carries a persistent overflow menu on every object row', () => {
    seed(connection, 'app_db', ['users'])
    render(<SidebarTree />)

    expect(screen.getByRole('button', { name: 'Actions for Local MySQL' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Actions for app_db' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Actions for users' })).toBeTruthy()
  })

  it.each(['mysql', 'postgres'] as const)('aligns the add-database action with %s database content', (engine) => {
    const target = { ...connection, engine }
    seed(target, 'app_db', [])
    useSidebarStore.setState(({ nodes }) => ({ nodes: {
      ...nodes, [target.id]: { ...nodes[target.id]!, expandedDbs: new Set() }
    }, addDatabaseConnection: null }))
    render(<SidebarTree />)

    const databaseRow = screen.getByText('app_db').closest('[role="treeitem"]') as HTMLElement
    const button = screen.getByRole('button', { name: 'Add database' })
    // TreeRow's border + chevron + gap, less the xs button's own horizontal padding.
    expect(button.parentElement?.style.paddingLeft).toBe(`${parseFloat(databaseRow.style.paddingLeft) + 16}px`)
    fireEvent.click(button)
    expect(useSidebarStore.getState().addDatabaseConnection).toEqual(target)
    expect(useSidebarStore.getState().nodes[target.id]?.expanded).toBe(true)
    useSidebarStore.getState().setAddDatabaseConnection(null)
  })

  it('renames a table inline with F2', async () => {
    seed(connection, 'app_db', ['users'])
    render(<SidebarTree />)

    const tableRow = screen.getAllByRole('treeitem')[2]!
    fireEvent.keyDown(tableRow, { key: 'F2' })

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'members' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(renameTableMock).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      database: 'app_db',
      table: 'users',
      newTable: 'members'
    })
  })

  it('renames a Redis key inline too — the rename modal is gone', async () => {
    seed(redisConnection, '0', ['cache:user:1'])
    render(<SidebarTree />)

    const rows = screen.getAllByRole('treeitem')
    // connection · database · "cache" folder · "user" folder · the key itself
    expect(rows).toHaveLength(5)
    fireEvent.keyDown(rows[rows.length - 1]!, { key: 'F2' })

    expect(useSidebarStore.getState().inlineRename?.table).toBe('cache:user:1')
    expect(await screen.findByRole('textbox')).toBeTruthy()
  })

  it('offers a first-run empty state with a real action instead of muted text', () => {
    useConnectionStore.setState({ connections: [] })
    useSidebarStore.setState({ keyword: '', nodes: {} })
    render(<SidebarTree />)

    fireEvent.click(screen.getByRole('button', { name: 'New connection' }))
    expect(useSidebarStore.getState().creating).toBe(true)
    useSidebarStore.getState().setCreating(false)
  })
})
