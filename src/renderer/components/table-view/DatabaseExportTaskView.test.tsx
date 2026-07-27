// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { useJobStore } from '@renderer/store/job-store'
import { useUIStore } from '@renderer/store/ui-store'
import type { ExportDatabaseRequest } from '../../../shared/types'
import { DatabaseExportTaskView } from './DatabaseExportTaskView'

const { exportDatabaseMock } = vi.hoisted(() => ({ exportDatabaseMock: vi.fn() }))

vi.mock('@renderer/lib/api', () => ({
  api: { db: { exportDatabase: exportDatabaseMock } },
  unwrap: async <T,>(value: Promise<T> | T): Promise<T> => await value
}))

const request: ExportDatabaseRequest = {
  connectionId: 'conn-1',
  database: 'shop',
  format: 'sql',
  sqlDialect: 'mysql',
  backend: 'mysqldump',
  includeCreateTable: true,
  includeData: true
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DatabaseExportTaskView', () => {
  let originalShowToast: ReturnType<typeof useUIStore.getState>['showToast']

  beforeEach(() => {
    useI18nStore.getState().setLocale('en')
    exportDatabaseMock.mockReset()
    useJobStore.setState({ jobs: new Map() })

    originalShowToast = useUIStore.getState().showToast
    useUIStore.setState({ showToast: vi.fn() })
  })

  afterEach(() => {
    useUIStore.setState({ showToast: originalShowToast })
  })

  it('registers the export with the job store so it stays visible after a tab switch', async () => {
    exportDatabaseMock.mockReturnValue(new Promise(() => {}))

    render(<DatabaseExportTaskView taskId="task-job" connectionName="prod" request={request} />)

    await waitFor(() => expect(useJobStore.getState().jobs.size).toBe(1))
    const job = Array.from(useJobStore.getState().jobs.values())[0]!
    expect(job.kind).toBe('export')
    expect(job.tabId).toBe('database-export:task-job')
    expect(job.status).toBe('running')
    // `db.exportDatabase` has no cancel channel, so the status bar must not
    // grow a Cancel button that would lie (blueprint risk 6).
    expect(job.onCancel).toBeUndefined()
  })

  it('guards closing a running export with a ConfirmDialog, not window.confirm', async () => {
    const nativeConfirm = vi.fn(() => true)
    vi.stubGlobal('confirm', nativeConfirm)
    exportDatabaseMock.mockReturnValue(new Promise(() => {}))

    const tabId = 'database-export:task-close'
    useUIStore.setState({
      workspaceTabs: [
        {
          id: tabId,
          title: 'Export · shop',
          view: { kind: 'database-export', exportTaskId: 'task-close', request }
        }
      ],
      activeTabId: tabId
    })

    render(<DatabaseExportTaskView taskId="task-close" connectionName="prod" request={request} />)
    await screen.findByText('Export options')

    act(() => useUIStore.getState().closeTab(tabId))

    expect(await screen.findByText('Close a running export?')).toBeTruthy()
    expect(useUIStore.getState().workspaceTabs).toHaveLength(1)
    expect(nativeConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))

    await waitFor(() => expect(useUIStore.getState().workspaceTabs).toHaveLength(0))

    vi.unstubAllGlobals()
    useUIStore.setState({ workspaceTabs: [], activeTabId: null, rightView: { kind: 'empty' } })
  })

  it('finishes the job and offers Retry when the export fails', async () => {
    exportDatabaseMock.mockRejectedValue(new Error('mysqldump missing'))

    render(<DatabaseExportTaskView taskId="task-error" connectionName="prod" request={request} />)

    expect(await screen.findByText('mysqldump missing')).toBeTruthy()
    await waitFor(() => {
      const job = Array.from(useJobStore.getState().jobs.values())[0]!
      expect(job.status).toBe('error')
    })
    expect(screen.getByRole('button', { name: 'Retry export' })).toBeTruthy()
  })
})
