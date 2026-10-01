import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExportTableRequest, ImportTableRequest } from '../../shared/types'
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
import { createTauriApi } from './tauri-api'
const exportRequest: ExportTableRequest = { connectionId: 'conn', database: 'db', table: 'items', format: 'sql', scope: 'all' }
describe('native security boundaries in the API adapter', () => {
  beforeEach(() => invokeMock.mockReset())
  it('passes only the backend dialog grant to a local export', async () => {
    invokeMock.mockResolvedValueOnce({ ok: true, data: [{ path: '/chosen/out.sql', grantId: 'one-use' }] })
      .mockResolvedValueOnce({ ok: true, data: { rowsExported: 1 } })
    await createTauriApi().db.exportTable(exportRequest, 'operation')
    expect(invokeMock.mock.calls).toEqual([
      ['file_pick', { purpose: 'export_table', defaultName: 'items.sql' }],
      ['db_export_table', { req: exportRequest, filePath: '/chosen/out.sql', fileGrant: 'one-use', operationId: 'operation' }]
    ])
  })
  it('ignores an import filename as a source path and requires a native selection', async () => {
    invokeMock.mockResolvedValueOnce({ ok: true, data: [] })
    const request: ImportTableRequest = { connectionId: 'conn', database: 'db', table: 'items', format: 'csv', fileName: '/arbitrary/secret' }
    const result = await createTauriApi().db.importTable(request)
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith('file_pick', { purpose: 'import_table', defaultName: undefined })
    expect(result.data?.canceled).toBe(true)
  })
  it('requires backend native confirmation before retrying a challenged SSH operation', async () => {
    invokeMock.mockResolvedValueOnce({ ok: false, error: 'SSH_HOST_KEY_CHALLENGE:' + JSON.stringify({ challengeId: 'challenge', fingerprint: 'SHA256:key' }) })
      .mockResolvedValueOnce({ ok: true, data: true })
      .mockResolvedValueOnce({ ok: true, data: ['db'] })
    expect(await createTauriApi().db.listDatabases('conn')).toEqual({ ok: true, data: ['db'] })
    expect(invokeMock.mock.calls).toEqual([
      ['db_list_databases', { connectionId: 'conn' }],
      ['ssh_host_key_confirm', { challengeId: 'challenge', fingerprint: 'SHA256:key' }],
      ['db_list_databases', { connectionId: 'conn' }]
    ])
  })
  it('never retries authentication after the user cancels host trust', async () => {
    invokeMock.mockResolvedValueOnce({ ok: false, error: 'SSH_HOST_KEY_CHALLENGE:' + JSON.stringify({ challengeId: 'no', fingerprint: 'SHA256:key' }) })
      .mockResolvedValueOnce({ ok: true, data: false })
    expect((await createTauriApi().db.listDatabases('conn')).ok).toBe(false)
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })
  it('replaces dropped renderer paths with the selected native files', async () => {
    invokeMock.mockResolvedValueOnce({ ok: true, data: [{ path: '/chosen/safe.txt', grantId: 'grant' }] })
      .mockResolvedValueOnce({ ok: true })
    await createTauriApi().ssh.uploadEntries({ connectionId: 'conn', remoteDir: '/remote', entries: [{ type: 'file', localPath: '/private/secret', relativePath: 'secret' }] })
    expect(invokeMock.mock.calls[1]).toEqual(['ssh_upload_entries', {
      req: { connectionId: 'conn', remoteDir: '/remote', entries: [{ type: 'file', localPath: '/chosen/safe.txt', relativePath: 'safe.txt' }] }, fileGrants: ['grant']
    }])
  })
  it('routes cancellation to its unique backend operation', async () => {
    invokeMock.mockResolvedValueOnce({ ok: true })
    await createTauriApi().operations.cancel('uuid')
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith('operation_cancel', { operationId: 'uuid' })
  })
})
