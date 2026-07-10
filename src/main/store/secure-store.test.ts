import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSafeStorage, isElectronRuntime } = vi.hoisted(() => ({
  getSafeStorage: vi.fn(),
  isElectronRuntime: vi.fn()
}))

vi.mock('../platform/electron-runtime', () => ({ getSafeStorage, isElectronRuntime }))

import { assertNodeSecretConfigured, decryptSecret, encryptSecret } from './secure-store'

const originalSecret = process.env['MYSQL_COMPARE_SECRET']
const originalLegacySecret = process.env['WEB_SECRET_KEY']

describe('secure-store', () => {
  beforeEach(() => {
    getSafeStorage.mockReset()
    isElectronRuntime.mockReset()
    getSafeStorage.mockReturnValue(null)
    isElectronRuntime.mockReturnValue(false)
    delete process.env['MYSQL_COMPARE_SECRET']
    delete process.env['WEB_SECRET_KEY']
  })

  afterEach(() => {
    restoreEnv('MYSQL_COMPARE_SECRET', originalSecret)
    restoreEnv('WEB_SECRET_KEY', originalLegacySecret)
    vi.restoreAllMocks()
  })

  it('refuses web encryption without a configured secret', () => {
    expect(() => assertNodeSecretConfigured()).toThrow('MYSQL_COMPARE_SECRET is required')
    expect(() => encryptSecret('database-password')).toThrow('MYSQL_COMPARE_SECRET is required')
  })

  it('encrypts and decrypts web secrets with AES-GCM when configured', () => {
    process.env['MYSQL_COMPARE_SECRET'] = 'a-strong-test-encryption-secret'
    const cipher = encryptSecret('database-password')
    expect(cipher).toMatch(/^node:/u)
    expect(decryptSecret(cipher)).toBe('database-password')
  })

  it('refuses Electron plaintext fallback and legacy base64 decoding', () => {
    isElectronRuntime.mockReturnValue(true)
    expect(() => encryptSecret('database-password')).toThrow('safeStorage is unavailable')

    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(decryptSecret(Buffer.from('database-password').toString('base64'))).toBeNull()
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

