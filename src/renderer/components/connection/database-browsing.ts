import type { SafeConnection } from '../../../shared/types'

export function configuredDatabases(connection: SafeConnection): string[] {
  const names = [connection.database, ...(connection.databases ?? []), ...Object.keys(connection.databaseCredentials ?? {})]
    .filter((name): name is string => Boolean(name?.trim())).map((name) => name.trim())
  if (!names.length && connection.engine === 'postgres') names.push(connection.username.trim() || 'postgres')
  return [...new Set(names)]
}

export function showsAllDatabases(connection: SafeConnection): boolean {
  return connection.showAllDatabases ?? (connection.engine !== 'postgres' && configuredDatabases(connection).length === 0)
}

export function databaseErrorKind(message: string): 'authentication' | 'permission' | 'connection' {
  if (/access denied .* to database|permission denied|no pg_hba/i.test(message)) return 'permission'
  if (/28P01|password authentication|authentication failed|Access denied for user/i.test(message)) return 'authentication'
  if (/42501|permission denied|access denied for database|no pg_hba|not allowed to connect/i.test(message)) return 'permission'
  return 'connection'
}
