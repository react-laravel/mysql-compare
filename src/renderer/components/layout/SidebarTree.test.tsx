// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import type { SafeConnection } from '../../../shared/types'
import { SidebarTree } from './SidebarTree'

afterEach(cleanup)

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

function createProps(overrides: Partial<React.ComponentProps<typeof SidebarTree>> = {}) {
  return {
    keyword: '',
    onKeywordChange: vi.fn(),
    onCreateConnection: vi.fn(),
    filteredConnections: [connection],
    nodes: {
      [connection.id]: {
        expanded: true,
        loading: false,
        databases: ['app_db'],
        tables: { app_db: ['users'] },
        expandedDbs: new Set(['app_db'])
      }
    },
    stickyDatabase: null,
    treeScrollRef: { current: null },
    dbRowRefs: { current: {} },
    getTableFilter: () => '',
    isSelectedDatabase: () => false,
    isSelectedTable: () => true,
    onToggleConnection: vi.fn(),
    onEditConnection: vi.fn(),
    onOpenSSHFiles: vi.fn(),
    onOpenSSHTerminal: vi.fn(),
    onOpenConnectionMenu: vi.fn(),
    onToggleDatabase: vi.fn(),
    onOpenDatabaseDetails: vi.fn(),
    onOpenSQLConsole: vi.fn(),
    onOpenDatabaseCredential: vi.fn(),
    onExportDatabase: vi.fn(),
    onCreateRedisKey: vi.fn(),
    onRefreshDatabase: vi.fn(),
    onTableFilterChange: vi.fn(),
    onSelectTable: vi.fn(),
    renamingTable: null,
    renameDraft: '',
    renameBusy: false,
    onStartRenameTable: vi.fn(),
    onRenameDraftChange: vi.fn(),
    onSubmitTableRename: vi.fn(),
    onCancelTableRename: vi.fn(),
    onOpenDatabaseMenu: vi.fn(),
    onOpenTableMenu: vi.fn(),
    ...overrides
  }
}

describe('SidebarTree inline table rename', () => {
  beforeEach(() => {
    useI18nStore.getState().setLocale('en')
  })

  it('starts inline editing when Enter is pressed on a table', () => {
    const props = createProps()
    render(<SidebarTree {...props} />)

    const tableRow = screen.getByText('users').closest('[role="button"]')!
    fireEvent.keyDown(tableRow, { key: 'Enter' })

    expect(props.onStartRenameTable).toHaveBeenCalledWith(connection, 'app_db', 'users')
  })

  it('edits the table name in place and saves with Enter', () => {
    const props = createProps({
      renamingTable: { connection, database: 'app_db', table: 'users' },
      renameDraft: 'users'
    })
    render(<SidebarTree {...props} />)

    const input = screen.getByRole('textbox', { name: 'New Table Name' })
    fireEvent.change(input, { target: { value: 'members' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(props.onRenameDraftChange).toHaveBeenCalledWith('members')
    expect(props.onSubmitTableRename).toHaveBeenCalledTimes(1)
  })
})
