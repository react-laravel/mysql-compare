// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'
import type { SafeConnection, TableSchema } from '../../../shared/types'
import { TableInfoView } from './TableInfoView'

const connection: SafeConnection = {
  id: 'conn-1',
  engine: 'mysql',
  name: 'prod',
  host: '127.0.0.1',
  port: 3306,
  username: 'root',
  useSSH: false,
  createdAt: 0,
  updatedAt: 0,
  hasPassword: true,
  hasSSHPassword: false,
  hasSSHPrivateKey: false
}

const { dropTableMock, executeSQLMock, getTableMock } = vi.hoisted(() => ({
  dropTableMock: vi.fn(),
  executeSQLMock: vi.fn(),
  getTableMock: vi.fn()
}))

vi.mock('@renderer/lib/api', () => ({
  api: {
    db: {
      dropTable: dropTableMock,
      executeSQL: executeSQLMock
    },
    schema: {
      getTable: getTableMock
    }
  },
  unwrap: async <T,>(value: Promise<T> | T): Promise<T> => await value
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const schema: TableSchema = {
  name: 'users',
  columns: [
    {
      name: 'id',
      type: 'int',
      nullable: false,
      defaultValue: null,
      isPrimaryKey: true,
      isAutoIncrement: true,
      comment: '',
      columnKey: 'PRI'
    }
  ],
  indexes: [{ name: 'PRIMARY', columns: ['id'], unique: true, type: 'BTREE' }],
  primaryKey: ['id'],
  createSQL: 'CREATE TABLE users (id int primary key)',
  rowEstimate: 1234,
  engine: 'InnoDB',
  charset: 'utf8mb4',
  tableComment: 'User accounts',
  dataLength: 4096,
  indexLength: 1024,
  dataFree: 512,
  avgRowLength: 256,
  autoIncrement: 2048,
  createdAt: '2026-05-03 10:00:00',
  updatedAt: '2026-05-03 11:00:00'
}

describe('TableInfoView', () => {
  let originalShowToast: ReturnType<typeof useUIStore.getState>['showToast']
  let originalCloseTableTabs: ReturnType<typeof useUIStore.getState>['closeTableTabs']
  let originalMarkTableDropped: ReturnType<typeof useUIStore.getState>['markTableDropped']

  beforeEach(() => {
    useI18nStore.getState().setLocale('en')
    getTableMock.mockReset()
    dropTableMock.mockReset()
    executeSQLMock.mockReset()
    getTableMock.mockResolvedValue(schema)
    dropTableMock.mockResolvedValue(undefined)
    executeSQLMock.mockResolvedValue(undefined)

    const currentState = useUIStore.getState()
    originalShowToast = currentState.showToast
    originalCloseTableTabs = currentState.closeTableTabs
    originalMarkTableDropped = currentState.markTableDropped

    useUIStore.setState({
      showToast: vi.fn(),
      closeTableTabs: vi.fn(),
      markTableDropped: vi.fn()
    })
    useConnectionStore.setState({ connections: [connection] })
    useSidebarStore.getState().setPendingConfirm(null)
  })

  afterEach(() => {
    useUIStore.setState({
      showToast: originalShowToast,
      closeTableTabs: originalCloseTableTabs,
      markTableDropped: originalMarkTableDropped
    })
  })

  it('renders table details and routes Drop table through the shared confirmation', async () => {
    render(<TableInfoView connectionId="conn-1" database="app_db" table="users" />)

    await screen.findByText('User accounts')

    expect(screen.getByText('1,234')).toBeTruthy()
    expect(screen.getByText('2,048')).toBeTruthy()
    expect(screen.getByText('Create table statement')).toBeTruthy()
    expect(screen.getByText('CREATE TABLE users (id int primary key)')).toBeTruthy()
    expect(screen.getByText('Danger Zone')).toBeTruthy()

    // Blueprint §2.8 / §3.3: the Info tab used to call a native `confirm()`
    // while the tree opened a themed dialog for the very same operation. Both
    // now request the one `sidebar-store.pendingConfirm`.
    fireEvent.click(screen.getByRole('button', { name: 'Delete Table' }))

    await waitFor(() =>
      expect(useSidebarStore.getState().pendingConfirm).toEqual({
        kind: 'drop-table',
        connection,
        database: 'app_db',
        table: 'users'
      })
    )
    expect(dropTableMock).not.toHaveBeenCalled()
  })
})
