// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { useUIStore } from '@renderer/store/ui-store'
import type { SSHListFilesResult } from '../../../shared/types'
import { SSHFileManager } from './SSHFileManager'

const { listFilesMock, deleteFileMock, downloadFileMock } = vi.hoisted(() => ({
  listFilesMock: vi.fn(),
  deleteFileMock: vi.fn(),
  downloadFileMock: vi.fn()
}))

vi.mock('@renderer/lib/api', () => ({
  api: {
    ssh: {
      listFiles: listFilesMock,
      deleteFile: deleteFileMock,
      downloadFile: downloadFileMock,
      downloadDirectory: vi.fn(),
      uploadFile: vi.fn(),
      uploadDirectory: vi.fn(),
      uploadEntries: vi.fn(),
      createDirectory: vi.fn(),
      moveFile: vi.fn()
    },
    system: { getPathForFile: () => '' }
  },
  unwrap: async <T,>(value: Promise<T> | T): Promise<T> => await value
}))

const listing: SSHListFilesResult = {
  path: '/var/www',
  parentPath: '/var',
  entries: [
    { name: 'storage', path: '/var/www/storage', type: 'directory', size: 0, modifiedAt: null, permissions: 'drwxr-xr-x' },
    { name: '.env', path: '/var/www/.env', type: 'file', size: 1200, modifiedAt: null, permissions: '-rw-r--r--' }
  ]
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SSHFileManager', () => {
  let originalShowToast: ReturnType<typeof useUIStore.getState>['showToast']

  beforeEach(() => {
    useI18nStore.getState().setLocale('en')
    listFilesMock.mockReset()
    deleteFileMock.mockReset()
    listFilesMock.mockResolvedValue(listing)
    deleteFileMock.mockResolvedValue({ canceled: false })

    originalShowToast = useUIStore.getState().showToast
    useUIStore.setState({ showToast: vi.fn() })
  })

  afterEach(() => {
    useUIStore.setState({ showToast: originalShowToast })
  })

  it('lists entries, filters them, and offers a breadcrumb per path segment', async () => {
    render(<SSHFileManager connectionId="conn-1" connectionName="prod-web" />)

    await screen.findByText('storage')
    expect(screen.getByText('.env')).toBeTruthy()

    // The breadcrumb replaced the always-visible path box (blueprint §3.7).
    expect(screen.getByRole('button', { name: 'var' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'www' })).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Filter this folder'), { target: { value: 'env' } })
    await waitFor(() => expect(screen.queryByText('storage')).toBeNull())
    expect(screen.getByText('.env')).toBeTruthy()
  })

  it('routes delete through the shared ConfirmDialog instead of window.confirm', async () => {
    const nativeConfirm = vi.fn(() => true)
    vi.stubGlobal('confirm', nativeConfirm)

    render(<SSHFileManager connectionId="conn-1" connectionName="prod-web" />)
    await screen.findByText('.env')

    // Every row carries a persistent ⋯ — the actions used to live only in a
    // toolbar that acted on a faintly highlighted "selected" row.
    const rowMenus = screen.getAllByRole('button', { name: 'More actions' })
    fireEvent.click(rowMenus[rowMenus.length - 1]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))

    expect(await screen.findByText('Delete this entry?')).toBeTruthy()
    expect(screen.getByText('/var/www/.env')).toBeTruthy()
    expect(deleteFileMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(deleteFileMock).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        remotePath: '/var/www/.env',
        type: 'file'
      })
    )
    expect(nativeConfirm).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('renders an error state with a retry action when the listing fails', async () => {
    listFilesMock.mockRejectedValueOnce(new Error('permission denied'))

    render(<SSHFileManager connectionId="conn-1" connectionName="prod-web" />)

    expect(await screen.findByText('Could not list this folder.')).toBeTruthy()

    listFilesMock.mockResolvedValue(listing)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('storage')).toBeTruthy()
  })
})
