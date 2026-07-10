// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import type { SafeConnection } from '../../../shared/types'
import { SidebarOverlays } from './SidebarOverlays'

afterEach(cleanup)

const connection: SafeConnection = {
  id: 'conn-1',
  engine: 'mysql',
  name: 'Local MySQL',
  group: undefined,
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

function createProps(overrides: Partial<React.ComponentProps<typeof SidebarOverlays>> = {}) {
  return {
    creating: false,
    editing: null,
    onConnectionDialogOpenChange: vi.fn(),
    onConnectionSaved: vi.fn(),
    onDeleteConnection: vi.fn(() => true),
    connectionMenu: null,
    onCloseConnectionMenu: vi.fn(),
    onCloseDatabaseConnection: vi.fn(),
    onEditConnection: vi.fn(),
    tableMenu: {
      x: 120,
      y: 80,
      connection,
      database: 'app_db',
      table: 'users'
    },
    onCloseTableMenu: vi.fn(),
    databaseMenu: null,
    onCloseDatabaseMenu: vi.fn(),
    onOpenDatabaseDetails: vi.fn(),
    onOpenDatabaseSQLConsole: vi.fn(),
    onOpenDatabaseCredentialDialog: vi.fn(),
    onCreateRedisKey: vi.fn(),
    onExportDatabase: vi.fn(),
    onRefreshDatabase: vi.fn(),
    onOpenTableDetails: vi.fn(),
    onRenameTable: vi.fn(),
    onCopyTable: vi.fn(),
    onShowCreateSQL: vi.fn(),
    onExportTable: vi.fn(),
    onImportTable: vi.fn(),
    onTruncateTable: vi.fn(),
    onDropTable: vi.fn(),
    renameDialog: null,
    renameDraft: '',
    actionBusy: false,
    onRenameDraftChange: vi.fn(),
    onRenameDialogOpenChange: vi.fn(),
    onSubmitRename: vi.fn(),
    createSQLDialog: null,
    onCreateSQLDialogOpenChange: vi.fn(),
    onCopyCreateSQL: vi.fn(),
    createRedisKeyDialog: null,
    onCreateRedisKeyDialogOpenChange: vi.fn(),
    onSubmitCreateRedisKey: vi.fn(),
    exportDialog: null,
    onExportDialogOpenChange: vi.fn(),
    exportDatabaseDialog: null,
    onExportDatabaseDialogOpenChange: vi.fn(),
    importDialog: null,
    onImportDialogOpenChange: vi.fn(),
    onImported: vi.fn(),
    databaseCredentialDialog: null,
    databaseCredentialUsername: '',
    databaseCredentialPassword: '',
    databaseCredentialUseDefault: true,
    databaseCredentialFeedback: null,
    onDatabaseCredentialUsernameChange: vi.fn(),
    onDatabaseCredentialPasswordChange: vi.fn(),
    onDatabaseCredentialUseDefaultChange: vi.fn(),
    onDatabaseCredentialDialogOpenChange: vi.fn(),
    onTestDatabaseCredential: vi.fn(),
    onSubmitDatabaseCredential: vi.fn(),
    ...overrides
  }
}

describe('SidebarOverlays menus', () => {
  beforeEach(() => {
    useI18nStore.getState().setLocale('en')
  })

  it('opens table details from the table menu and no longer exposes direct table deletion there', () => {
    const props = createProps()

    render(<SidebarOverlays {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Table Details' }))

    expect(props.onOpenTableDetails).toHaveBeenCalledWith(props.tableMenu)
    expect(screen.queryByText('Drop Table')).toBeNull()
    expect(screen.getByText('Truncate Table')).toBeTruthy()
  })

  it('opens database details from the database menu', () => {
    const props = createProps({
      tableMenu: null,
      databaseMenu: {
        x: 160,
        y: 96,
        connection: postgresConnection,
        database: 'app_db'
      }
    })

    render(<SidebarOverlays {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Database Details' }))

    expect(props.onOpenDatabaseDetails).toHaveBeenCalledWith(props.databaseMenu)
    expect(screen.getByText('Open SQL Console')).toBeTruthy()
  })

  it('opens database credential settings from the database menu', () => {
    const props = createProps({
      tableMenu: null,
      databaseMenu: {
        x: 160,
        y: 96,
        connection: postgresConnection,
        database: 'app_db'
      }
    })

    render(<SidebarOverlays {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Database Credentials...' }))

    expect(props.onOpenDatabaseCredentialDialog).toHaveBeenCalledWith(props.databaseMenu)
  })

  it('switches a database from the server account to a custom account and can test it', () => {
    const props = createProps({
      tableMenu: null,
      databaseCredentialDialog: {
        connection: postgresConnection,
        database: 'app_db'
      },
      databaseCredentialUsername: 'app_user',
      databaseCredentialUseDefault: false
    })

    render(<SidebarOverlays {...props} />)

    expect(screen.getByText('Database Access Account')).toBeTruthy()
    expect(screen.getByDisplayValue('app_user')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(props.onTestDatabaseCredential).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Server account' }))
    expect(props.onDatabaseCredentialUseDefaultChange).toHaveBeenCalledWith(true)
  })

  it('closes a database connection from the connection menu', () => {
    const props = createProps({
      tableMenu: null,
      connectionMenu: {
        x: 120,
        y: 80,
        connection
      }
    })

    render(<SidebarOverlays {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close Database Connection' }))

    expect(props.onCloseDatabaseConnection).toHaveBeenCalledWith(props.connectionMenu)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
  })
})
