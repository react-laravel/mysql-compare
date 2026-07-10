import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionConfig } from '../../shared/types'

const { getFingerprint, setFingerprint, isElectronRuntime, showMessageBox } = vi.hoisted(() => ({
  getFingerprint: vi.fn(),
  setFingerprint: vi.fn(),
  isElectronRuntime: vi.fn(),
  showMessageBox: vi.fn()
}))

vi.mock('../store/ssh-host-key-store', () => ({
  sshHostKeyStore: { get: getFingerprint, set: setFingerprint }
}))
vi.mock('../platform/electron-runtime', () => ({ isElectronRuntime, showMessageBox }))

import { formatHostFingerprint, verifyHostFingerprint } from './ssh-host-verifier'

const originalHostKeys = process.env['MYSQL_COMPARE_SSH_HOST_KEYS']

describe('SSH host verifier', () => {
  beforeEach(() => {
    getFingerprint.mockReset()
    setFingerprint.mockReset()
    isElectronRuntime.mockReset()
    showMessageBox.mockReset()
    isElectronRuntime.mockReturnValue(false)
    delete process.env['MYSQL_COMPARE_SSH_HOST_KEYS']
  })

  afterEach(() => {
    if (originalHostKeys === undefined) delete process.env['MYSQL_COMPARE_SSH_HOST_KEYS']
    else process.env['MYSQL_COMPARE_SSH_HOST_KEYS'] = originalHostKeys
    vi.restoreAllMocks()
  })

  it('rejects an unknown web SSH host instead of trusting it automatically', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(verifyHostFingerprint(createConnection(), fingerprint())).resolves.toBe(false)
    expect(setFingerprint).not.toHaveBeenCalled()
  })

  it('accepts and persists an explicitly pinned web fingerprint', async () => {
    process.env['MYSQL_COMPARE_SSH_HOST_KEYS'] = JSON.stringify({
      'ssh.internal:22': fingerprint()
    })
    await expect(verifyHostFingerprint(createConnection(), fingerprint())).resolves.toBe(true)
    expect(setFingerprint).toHaveBeenCalledWith('conn-1', 'ssh.internal', 22, fingerprint())
  })

  it('uses the explicit web pin instead of a conflicting persisted fingerprint', async () => {
    getFingerprint.mockReturnValue('SHA256:previously-auto-trusted')
    process.env['MYSQL_COMPARE_SSH_HOST_KEYS'] = JSON.stringify({
      'ssh.internal:22': fingerprint()
    })

    await expect(verifyHostFingerprint(createConnection(), fingerprint())).resolves.toBe(true)
    expect(setFingerprint).toHaveBeenCalledWith('conn-1', 'ssh.internal', 22, fingerprint())
  })

  it('rejects a web host that matches persisted state but not the explicit pin', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    getFingerprint.mockReturnValue(fingerprint())
    process.env['MYSQL_COMPARE_SSH_HOST_KEYS'] = JSON.stringify({
      'ssh.internal:22': 'SHA256:administrator-pin'
    })

    await expect(verifyHostFingerprint(createConnection(), fingerprint())).resolves.toBe(false)
    expect(setFingerprint).not.toHaveBeenCalled()
  })

  it('rejects an unknown web host even when persisted state exists', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    getFingerprint.mockReturnValue('SHA256:previous')
    await expect(verifyHostFingerprint(createConnection(), fingerprint())).resolves.toBe(false)
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('keeps the Electron trust confirmation flow', async () => {
    isElectronRuntime.mockReturnValue(true)
    showMessageBox.mockResolvedValue({ response: 0 })
    await expect(verifyHostFingerprint(createConnection(), fingerprint())).resolves.toBe(true)
    expect(showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ title: 'Trust SSH Host' }))
    expect(setFingerprint).toHaveBeenCalledTimes(1)
  })

  it('keeps persisted TOFU checks for Electron connections', async () => {
    isElectronRuntime.mockReturnValue(true)
    getFingerprint.mockReturnValue('SHA256:previous')

    await expect(verifyHostFingerprint(createConnection(), fingerprint())).resolves.toBe(false)
    expect(showMessageBox).not.toHaveBeenCalled()
  })
})

function fingerprint(): string {
  return formatHostFingerprint(Buffer.from('host-key'))
}

function createConnection(): ConnectionConfig {
  return {
    id: 'conn-1',
    engine: 'postgres',
    name: 'Postgres',
    host: 'db.internal',
    port: 5432,
    username: 'postgres',
    useSSH: true,
    sshHost: 'ssh.internal',
    sshPort: 22,
    sshUsername: 'deploy',
    createdAt: 1,
    updatedAt: 1
  }
}
