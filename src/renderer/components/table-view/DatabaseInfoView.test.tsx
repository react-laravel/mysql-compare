// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { useUIStore } from '@renderer/store/ui-store'
import type { DatabaseInfo } from '../../../shared/types'
import { DatabaseInfoView } from './DatabaseInfoView'

const { dropDatabaseMock, getDatabaseInfoMock } = vi.hoisted(() => ({
  dropDatabaseMock: vi.fn(),
  getDatabaseInfoMock: vi.fn()
}))

vi.mock('@renderer/lib/api', () => ({
  api: {
    db: {
      dropDatabase: dropDatabaseMock,
      getDatabaseInfo: getDatabaseInfoMock
    }
  },
  unwrap: async <T,>(value: Promise<T> | T): Promise<T> => await value
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const databaseInfo: DatabaseInfo = {
  name: 'app_db',
  tableCount: 12,
  rowEstimate: 12345,
  dataLength: 4096,
  indexLength: 1024,
  totalSize: 8192,
  dataFree: 512,
  charset: 'utf8mb4',
  collation: 'utf8mb4_general_ci',
  owner: 'root',
  comment: 'Primary application database'
}

describe('DatabaseInfoView', () => {
  let originalShowToast: ReturnType<typeof useUIStore.getState>['showToast']
  let originalCloseDatabaseTabs: ReturnType<typeof useUIStore.getState>['closeDatabaseTabs']
  let originalMarkDatabaseDropped: ReturnType<typeof useUIStore.getState>['markDatabaseDropped']

  beforeEach(() => {
    useI18nStore.getState().setLocale('en')
    getDatabaseInfoMock.mockReset()
    dropDatabaseMock.mockReset()
    getDatabaseInfoMock.mockResolvedValue(databaseInfo)
    dropDatabaseMock.mockResolvedValue(undefined)

    const currentState = useUIStore.getState()
    originalShowToast = currentState.showToast
    originalCloseDatabaseTabs = currentState.closeDatabaseTabs
    originalMarkDatabaseDropped = currentState.markDatabaseDropped

    useUIStore.setState({
      showToast: vi.fn(),
      closeDatabaseTabs: vi.fn(),
      markDatabaseDropped: vi.fn()
    })
  })

  afterEach(() => {
    useUIStore.setState({
      showToast: originalShowToast,
      closeDatabaseTabs: originalCloseDatabaseTabs,
      markDatabaseDropped: originalMarkDatabaseDropped
    })
  })

  it('renders database details and deletes the database from the danger zone', async () => {
    render(<DatabaseInfoView connectionId="conn-1" database="app_db" />)

    await screen.findByText('Primary application database')

    expect(getDatabaseInfoMock).toHaveBeenCalledWith('conn-1', 'app_db')
    expect(screen.getByText('12,345')).toBeTruthy()
    expect(screen.getByText('utf8mb4_general_ci')).toBeTruthy()
    expect(screen.getByText('Danger Zone')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Database' }))

    expect(dropDatabaseMock).not.toHaveBeenCalled()
    expect(screen.getByText('Confirm database deletion')).toBeTruthy()
    expect(
      screen.getByText('Drop database "app_db"? This removes all tables and cannot be undone.')
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(dropDatabaseMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Confirm database deletion')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Database' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))

    await waitFor(() =>
      expect(dropDatabaseMock).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        database: 'app_db'
      })
    )

    expect(useUIStore.getState().markDatabaseDropped).toHaveBeenCalledWith('conn-1', 'app_db')
    expect(useUIStore.getState().closeDatabaseTabs).toHaveBeenCalledWith('conn-1', 'app_db')
    expect(useUIStore.getState().showToast).toHaveBeenCalledWith(
      'Dropped database app_db',
      'success'
    )
  })
})
