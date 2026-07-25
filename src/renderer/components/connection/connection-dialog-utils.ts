import type { ConnectionConfig, DbEngine, SafeConnection } from '../../../shared/types'

export type SSHAuthMethod = 'password' | 'privateKey'

export interface ValidateConnectionOptions {
  hasSSHPassword?: boolean
  hasSSHPrivateKey?: boolean
  sshAuthMethod?: SSHAuthMethod
}

export const DEFAULT_PORT: Record<DbEngine, number> = {
  mysql: 3306,
  postgres: 5432,
  redis: 6379
}

export const DEFAULT_USERNAME: Record<DbEngine, string> = {
  mysql: 'root',
  postgres: 'postgres',
  redis: ''
}

export function getInitialSSHAuthMethod(
  connection?: SafeConnection | null
): SSHAuthMethod {
  return connection?.hasSSHPrivateKey ? 'privateKey' : 'password'
}

export function createInitialForm(
  connection?: SafeConnection | null,
  sshSource?: SafeConnection | null
): ConnectionConfig {
  const engine: DbEngine = connection?.engine || (sshSource ? 'postgres' : 'mysql')
  return {
    id: connection?.id || '',
    engine,
    name: connection?.name || '',
    group: connection?.group || sshSource?.group || '',
    host: connection?.host || sshSource?.host || '127.0.0.1',
    port: connection?.port || DEFAULT_PORT[engine],
    username: connection?.username || DEFAULT_USERNAME[engine],
    password: '',
    database: connection?.database || '',
    useSSH: connection?.useSSH || sshSource?.useSSH || false,
    sshHost: connection?.sshHost || sshSource?.sshHost || '',
    sshPort: connection?.sshPort || sshSource?.sshPort || 22,
    sshUsername: connection?.sshUsername || sshSource?.sshUsername || '',
    sshPassword: '',
    sshPrivateKey: '',
    sshPrivateKeyPath: connection?.sshPrivateKeyPath || sshSource?.sshPrivateKeyPath || '',
    sshPassphrase: '',
    sshSourceConnectionId: sshSource?.id,
    createdAt: connection?.createdAt || 0,
    updatedAt: 0
  }
}

export function buildPayload(
  form: ConnectionConfig,
  sshAuthMethod: SSHAuthMethod = 'password'
): ConnectionConfig {
  const host = form.host.trim()
  const usesSSHPassword = form.useSSH && sshAuthMethod === 'password'
  const usesSSHPrivateKey = form.useSSH && sshAuthMethod === 'privateKey'
  return {
    ...form,
    name: form.name.trim() || host,
    group: form.group?.trim(),
    host,
    username: form.username.trim(),
    database: form.database?.trim(),
    sshHost: form.useSSH ? form.sshHost?.trim() : undefined,
    sshUsername: form.useSSH ? form.sshUsername?.trim() : undefined,
    password: form.password ? form.password : undefined,
    sshPassword: usesSSHPassword ? form.sshPassword || undefined : form.useSSH ? '' : undefined,
    sshPrivateKey: usesSSHPrivateKey
      ? form.sshPrivateKey?.trim() || undefined
      : form.useSSH ? '' : undefined,
    sshPrivateKeyPath: usesSSHPrivateKey
      ? form.sshPrivateKeyPath?.trim() || undefined
      : form.useSSH ? '' : undefined,
    sshPassphrase: usesSSHPrivateKey
      ? form.sshPassphrase || undefined
      : form.useSSH ? '' : undefined
  }
}

export function validateConnectionForm(
  form: ConnectionConfig,
  options?: ValidateConnectionOptions
): string | null {
  if (!form.host.trim()) return 'Host is required'
  if (form.engine !== 'redis' && !form.username.trim()) return 'Username is required'
  if (!isValidPort(form.port)) return 'Port must be between 1 and 65535'

  if (!form.useSSH) return null

  if (!form.sshHost?.trim()) return 'SSH host is required when SSH tunnel is enabled'
  if (!form.sshUsername?.trim()) return 'SSH username is required when SSH tunnel is enabled'
  if (!isValidPort(form.sshPort)) return 'SSH port must be between 1 and 65535'

  const sshAuthMethod = options?.sshAuthMethod ?? 'password'
  if (sshAuthMethod === 'password') {
    const hasSSHPassword = Boolean(form.sshPassword?.trim()) || Boolean(options?.hasSSHPassword)
    if (!hasSSHPassword) {
      return 'SSH password is required when password authentication is selected'
    }
  } else {
    const hasSSHKey =
      Boolean(form.sshPrivateKey?.trim()) ||
      Boolean(options?.hasSSHPrivateKey) ||
      Boolean(form.sshPrivateKeyPath?.trim())
    if (!hasSSHKey) {
      return 'SSH private key is required when private key authentication is selected'
    }
  }

  return null
}

export function parsePortValue(value: string, fallback: number): number {
  if (!value.trim()) return fallback
  const port = Number(value)
  return Number.isInteger(port) ? port : fallback
}

function isValidPort(value: number | undefined): boolean {
  if (value === undefined) return false
  return Number.isInteger(value) && value >= 1 && value <= 65535
}
