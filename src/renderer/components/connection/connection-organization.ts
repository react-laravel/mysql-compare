import type { SafeConnection } from '../../../shared/types'

function normalizeHost(value: string): string {
  const host = value.trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  return ['localhost', '::1', '127.0.0.1'].includes(host) ? '127.0.0.1' : host
}

/** Database ports/accounts do not split a host; SSH loopback belongs to its server. */
export function connectionHostGroup(connection: SafeConnection): string {
  const host = normalizeHost(connection.host)
  if (!connection.useSSH || !connection.sshHost?.trim()) return host
  const sshHost = normalizeHost(connection.sshHost)
  const gateway = connection.sshPort && connection.sshPort !== 22
    ? `${sshHost}:${connection.sshPort}`
    : sshHost
  return host === '127.0.0.1' || host === sshHost ? gateway : `${gateway} → ${host}`
}

export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (index < 0 || target < 0 || index >= items.length || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}
