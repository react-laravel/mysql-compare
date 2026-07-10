// 连接元数据持久化。敏感字段（password / sshPassword / sshPrivateKey / sshPassphrase）
// 落盘前一律走 safeStorage 加密。读取时给主进程内部使用解密版本，给渲染端只暴露安全版本。
import { v4 as uuid } from 'uuid'
import type {
  ConnectionConfig,
  DatabaseCredentialConfig,
  DbEngine,
  SafeConnection
} from '../../shared/types'
import { decryptSecret, encryptSecret } from './secure-store'
import { createStoreOptions } from './store-config'
import { SimpleJsonStore } from './simple-json-store'

interface StoredDatabaseCredential {
  username?: string
  passwordCipher: string | null
}

interface StoredConnection extends Omit<ConnectionConfig,
  'password' | 'databaseCredentials' | 'sshPassword' | 'sshPrivateKey' | 'sshPassphrase'> {
  passwordCipher: string | null
  databaseCredentials?: Record<string, StoredDatabaseCredential>
  sshPasswordCipher: string | null
  sshPrivateKeyCipher: string | null
  sshPassphraseCipher: string | null
}

interface Schema {
  connections: StoredConnection[]
}

const store = new SimpleJsonStore<Schema>(createStoreOptions<Schema>('connections', { connections: [] }))

function normalizeEngine(engine: DbEngine | undefined): DbEngine {
  return engine || 'mysql'
}

function toStoredDatabaseCredentials(
  credentials: Record<string, DatabaseCredentialConfig> | undefined
): Record<string, StoredDatabaseCredential> | undefined {
  if (!credentials) return undefined

  const entries = Object.entries(credentials).flatMap(([database, credential]) => {
    const databaseName = database.trim()
    const username = credential.username?.trim()
    if (!databaseName || !username) return []
    return [[
      databaseName,
      {
        username,
        passwordCipher: encryptSecret(credential.password)
      }
    ] as const]
  })

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function toSafeDatabaseCredentials(
  credentials: Record<string, StoredDatabaseCredential> | undefined
): SafeConnection['databaseCredentials'] {
  if (!credentials) return undefined

  const entries = Object.entries(credentials).flatMap(([database, credential]) => {
    if (!credential.username) return []
    return [[
      database,
      {
        username: credential.username,
        hasPassword: !!credential.passwordCipher
      }
    ] as const]
  })

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function toFullDatabaseCredentials(
  credentials: Record<string, StoredDatabaseCredential> | undefined
): ConnectionConfig['databaseCredentials'] {
  if (!credentials) return undefined

  const entries = Object.entries(credentials).flatMap(([database, credential]) => {
    if (!credential.username) return []
    return [[
      database,
      {
        username: credential.username,
        password: decryptSecret(credential.passwordCipher) ?? undefined
      }
    ] as const]
  })

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function toStored(c: ConnectionConfig): StoredConnection {
  return {
    id: c.id || uuid(),
    engine: normalizeEngine(c.engine),
    name: c.name,
    group: c.group,
    host: c.host,
    port: c.port,
    username: c.username,
    database: c.database,
    databaseCredentials: toStoredDatabaseCredentials(c.databaseCredentials),
    useSSH: c.useSSH,
    sshHost: c.sshHost,
    sshPort: c.sshPort,
    sshUsername: c.sshUsername,
    sshPrivateKeyPath: c.sshPrivateKeyPath,
    createdAt: c.createdAt || Date.now(),
    updatedAt: Date.now(),
    passwordCipher: encryptSecret(c.password),
    sshPasswordCipher: encryptSecret(c.sshPassword),
    sshPrivateKeyCipher: encryptSecret(c.sshPrivateKey),
    sshPassphraseCipher: encryptSecret(c.sshPassphrase)
  }
}

function toSafe(s: StoredConnection): SafeConnection {
  return {
    id: s.id,
    engine: normalizeEngine(s.engine),
    name: s.name,
    group: s.group,
    host: s.host,
    port: s.port,
    username: s.username,
    database: s.database,
    useSSH: s.useSSH,
    sshHost: s.sshHost,
    sshPort: s.sshPort,
    sshUsername: s.sshUsername,
    sshPrivateKeyPath: s.sshPrivateKeyPath,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    hasPassword: !!s.passwordCipher,
    databaseCredentials: toSafeDatabaseCredentials(s.databaseCredentials),
    hasSSHPassword: !!s.sshPasswordCipher,
    hasSSHPrivateKey: !!s.sshPrivateKeyCipher
  }
}

function pickSecret(nextValue: string | undefined, previousValue: string | undefined): string | undefined {
  if (typeof nextValue === 'string' && nextValue.trim() !== '') return nextValue
  return previousValue
}

/** 主进程内部使用：拿到包含明文密码的完整 ConnectionConfig */
function toFull(s: StoredConnection): ConnectionConfig {
  return {
    id: s.id,
    engine: normalizeEngine(s.engine),
    name: s.name,
    group: s.group,
    host: s.host,
    port: s.port,
    username: s.username,
    database: s.database,
    useSSH: s.useSSH,
    sshHost: s.sshHost,
    sshPort: s.sshPort,
    sshUsername: s.sshUsername,
    sshPrivateKeyPath: s.sshPrivateKeyPath,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    password: decryptSecret(s.passwordCipher) ?? undefined,
    databaseCredentials: toFullDatabaseCredentials(s.databaseCredentials),
    sshPassword: decryptSecret(s.sshPasswordCipher) ?? undefined,
    sshPrivateKey: decryptSecret(s.sshPrivateKeyCipher) ?? undefined,
    sshPassphrase: decryptSecret(s.sshPassphraseCipher) ?? undefined
  }
}

export const connectionStore = {
  list(): SafeConnection[] {
    return store.get('connections').map(toSafe)
  },

  /** 主进程内部使用 */
  getFull(id: string): ConnectionConfig | null {
    const found = store.get('connections').find((c) => c.id === id)
    return found ? toFull(found) : null
  },

  resolveSecrets(conn: ConnectionConfig): ConnectionConfig {
    if (!conn.id) return conn
    const previous = this.getFull(conn.id)
    if (!previous) return conn
    return {
      ...previous,
      ...conn,
      password: pickSecret(conn.password, previous.password),
      sshPassword: pickSecret(conn.sshPassword, previous.sshPassword),
      sshPrivateKey: pickSecret(conn.sshPrivateKey, previous.sshPrivateKey),
      sshPassphrase: pickSecret(conn.sshPassphrase, previous.sshPassphrase)
    }
  },

  upsert(conn: ConnectionConfig): SafeConnection {
    const list = store.get('connections')
    const idx = list.findIndex((c) => c.id === conn.id)

    // 如果调用方没传明文密码，且记录已存在 → 保留原密文
    const next = toStored(conn)
    if (idx >= 0) {
      const prev = list[idx]!
      if (conn.password === undefined) next.passwordCipher = prev.passwordCipher
      if (conn.databaseCredentials === undefined) next.databaseCredentials = prev.databaseCredentials
      if (conn.sshPassword === undefined) next.sshPasswordCipher = prev.sshPasswordCipher
      if (conn.sshPrivateKey === undefined) next.sshPrivateKeyCipher = prev.sshPrivateKeyCipher
      if (conn.sshPassphrase === undefined) next.sshPassphraseCipher = prev.sshPassphraseCipher
      if (conn.sshPrivateKeyPath === undefined) next.sshPrivateKeyPath = prev.sshPrivateKeyPath
      next.createdAt = prev.createdAt
      list[idx] = next
    } else {
      list.push(next)
    }

    store.set('connections', list)
    return toSafe(next)
  },

  remove(id: string): void {
    const list = store.get('connections').filter((c) => c.id !== id)
    store.set('connections', list)
  },

  setDatabaseCredential(
    connectionId: string,
    database: string,
    credential: DatabaseCredentialConfig
  ): SafeConnection {
    const databaseName = database.trim()
    if (!databaseName) throw new Error('Database is required')

    const list = store.get('connections')
    const idx = list.findIndex((c) => c.id === connectionId)
    if (idx < 0) throw new Error(`Connection ${connectionId} not found`)

    const prev = list[idx]!
    const username = credential.username?.trim()
    const credentials = { ...(prev.databaseCredentials ?? {}) }

    if (!username) {
      delete credentials[databaseName]
    } else {
      const existing = credentials[databaseName]
      credentials[databaseName] = {
        username,
        passwordCipher:
          typeof credential.password === 'string' && credential.password !== ''
            ? encryptSecret(credential.password)
            : existing?.passwordCipher ?? null
      }
    }

    const next: StoredConnection = {
      ...prev,
      databaseCredentials: Object.keys(credentials).length > 0 ? credentials : undefined,
      updatedAt: Date.now()
    }
    list[idx] = next
    store.set('connections', list)
    return toSafe(next)
  },

  resolveDatabaseCredentialTest(
    connectionId: string,
    database: string,
    credential: DatabaseCredentialConfig
  ): ConnectionConfig {
    const databaseName = database.trim()
    if (!databaseName) throw new Error('Database is required')

    const connection = this.getFull(connectionId)
    if (!connection) throw new Error(`Connection ${connectionId} not found`)

    const databaseCredentials = { ...(connection.databaseCredentials ?? {}) }
    const username = credential.username?.trim()
    if (!username) {
      delete databaseCredentials[databaseName]
    } else {
      databaseCredentials[databaseName] = {
        username,
        password: pickSecret(credential.password, databaseCredentials[databaseName]?.password)
      }
    }

    return {
      ...connection,
      database: databaseName,
      databaseCredentials: Object.keys(databaseCredentials).length > 0 ? databaseCredentials : undefined
    }
  }
}
