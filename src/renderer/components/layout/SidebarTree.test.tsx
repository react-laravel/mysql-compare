// @vitest-environment jsdom
/**
 * What Chunk 6 owes the sidebar: real tree semantics on *every* row (connection
 * and database rows had none), a persistent `⋯` instead of hover-gated icons,
 * and inline rename for both engines.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'
import type { SafeConnection } from '../../../shared/types'
import { SidebarTree } from './SidebarTree'

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

  it('carries a persistent overflow menu on every object row', () => {
    seed(connection, 'app_db', ['users'])
    render(<SidebarTree />)

    expect(screen.getByRole('button', { name: 'Actions for Local MySQL' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Actions for app_db' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Actions for users' })).toBeTruthy()
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
