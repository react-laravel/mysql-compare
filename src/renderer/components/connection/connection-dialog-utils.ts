import type { ConnectionConfig, DbEngine, SafeConnection } from '../../../shared/types'

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

export function createInitialForm(connection?: SafeConnection | null): ConnectionConfig {
  const engine: DbEngine = connection?.engine || 'mysql'
  return {
    id: connection?.id || '',
    engine,
    name: connection?.name || '',
    group: connection?.group || '',
    host: connection?.host || '127.0.0.1',
    port: connection?.port || DEFAULT_PORT[engine],
    username: connection?.username || DEFAULT_USERNAME[engine],
    password: '',
    database: connection?.database || '',
    useSSH: connection?.useSSH || false,
    sshHost: connection?.sshHost || '',
    sshPort: connection?.sshPort || 22,
    sshUsername: connection?.sshUsername || '',
    sshPassword: '',
    sshPrivateKey: '',
    sshPassphrase: '',
    createdAt: connection?.createdAt || 0,
    updatedAt: 0
  }
}

export function buildPayload(form: ConnectionConfig): ConnectionConfig {
  return {
    ...form,
    name: form.name.trim(),
    group: form.group?.trim(),
    host: form.host.trim(),
    username: form.username.trim(),
    database: form.database?.trim(),
    sshHost: form.useSSH ? form.sshHost?.trim() : undefined,
    sshUsername: form.useSSH ? form.sshUsername?.trim() : undefined,
    password: form.password ? form.password : undefined,
    sshPassword: form.useSSH && form.sshPassword ? form.sshPassword : undefined,
    sshPrivateKey: form.useSSH && form.sshPrivateKey?.trim() ? form.sshPrivateKey.trim() : undefined,
    sshPassphrase: form.useSSH && form.sshPassphrase ? form.sshPassphrase : undefined
  }
}

export function validateConnectionForm(form: ConnectionConfig): string | null {
  if (!form.name.trim()) return 'Name is required'
  if (!form.host.trim()) return 'Host is required'
  if (form.engine !== 'redis' && !form.username.trim()) return 'Username is required'
  if (!isValidPort(form.port)) return 'Port must be between 1 and 65535'

  if (!form.useSSH) return null

  if (!form.sshHost?.trim()) return 'SSH host is required when SSH tunnel is enabled'
  if (!form.sshUsername?.trim()) return 'SSH username is required when SSH tunnel is enabled'
  if (!isValidPort(form.sshPort)) return 'SSH port must be between 1 and 65535'

  const hasSSHPassword = Boolean(form.sshPassword?.trim())
  const hasSSHKey = Boolean(form.sshPrivateKey?.trim())
  if (!hasSSHPassword && !hasSSHKey) {
    return 'SSH password or private key is required when SSH tunnel is enabled'
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
