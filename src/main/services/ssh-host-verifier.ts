import { createHash } from 'node:crypto'
import type { VerifyCallback } from 'ssh2'
import type { ConnectionConfig } from '../../shared/types'
import { isElectronRuntime, showMessageBox } from '../platform/electron-runtime'
import { sshHostKeyStore } from '../store/ssh-host-key-store'

export function createSSHHostVerifier(
  conn: ConnectionConfig
): (key: Buffer, verify: VerifyCallback) => void {
  return (key, verify) => {
    const fingerprint = formatHostFingerprint(key)
    void verifyHostFingerprint(conn, fingerprint).then(verify, () => verify(false))
  }
}

export function formatHostFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/u, '')}`
}

export async function verifyHostFingerprint(
  conn: ConnectionConfig,
  fingerprint: string
): Promise<boolean> {
  const host = conn.sshHost ?? ''
  const port = conn.sshPort || 22

  if (!isElectronRuntime()) {
    const configured = getConfiguredWebFingerprint(conn.id, host, port)
    if (!configured) {
      console.error(
        `[ssh-host-verifier] Unknown SSH host ${host}:${port}. Configure its SHA256 fingerprint in MYSQL_COMPARE_SSH_HOST_KEYS.`
      )
      return false
    }
    if (configured !== fingerprint) {
      console.error(`[ssh-host-verifier] SSH host fingerprint mismatch for ${host}:${port}.`)
      return false
    }

    sshHostKeyStore.set(conn.id, host, port, fingerprint)
    return true
  }

  const saved = sshHostKeyStore.get(conn.id, host, port)
  if (saved) return saved === fingerprint

  const result = await showMessageBox({
    type: 'warning',
    buttons: ['Trust Host', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Trust SSH Host',
    message: `Trust SSH host ${host}:${port}?`,
    detail: `Fingerprint: ${fingerprint}`
  })
  if (result.response !== 0) return false

  sshHostKeyStore.set(conn.id, host, port, fingerprint)
  return true
}

function getConfiguredWebFingerprint(
  connectionId: string,
  host: string,
  port: number
): string | undefined {
  const raw = process.env['MYSQL_COMPARE_SSH_HOST_KEYS']?.trim()
  if (!raw) return undefined

  try {
    const values = JSON.parse(raw) as unknown
    if (!values || typeof values !== 'object' || Array.isArray(values)) return undefined
    const fingerprints = values as Record<string, unknown>
    const value = fingerprints[`${connectionId}:${host}:${port}`] ?? fingerprints[`${host}:${port}`]
    return typeof value === 'string' && /^SHA256:[A-Za-z0-9+/]+$/u.test(value) ? value : undefined
  } catch {
    console.error('[ssh-host-verifier] MYSQL_COMPARE_SSH_HOST_KEYS must be a JSON object.')
    return undefined
  }
}
