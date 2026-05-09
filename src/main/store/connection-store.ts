// 连接元数据持久化。敏感字段（password / sshPassword / sshPrivateKey / sshPassphrase）
// 落盘前一律走 safeStorage 加密。读取时给主进程内部使用解密版本，给渲染端只暴露安全版本。
import Store from 'electron-store'
import { v4 as uuid } from 'uuid'
import type { ConnectionConfig, DbEngine, SafeConnection } from '../../shared/types'
import { decryptSecret, encryptSecret } from './secure-store'
import { createStoreOptions } from './store-config'

interface StoredConnection extends Omit<ConnectionConfig,
  'password' | 'sshPassword' | 'sshPrivateKey' | 'sshPassphrase'> {
  passwordCipher: string | null
  sshPasswordCipher: string | null
  sshPrivateKeyCipher: string | null
  sshPassphraseCipher: string | null
}

interface Schema {
  connections: StoredConnection[]
}

const store = new Store<Schema>(createStoreOptions<Schema>('connections', { connections: [] }))

function normalizeEngine(engine: DbEngine | undefined): DbEngine {
  return engine || 'mysql'
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
    useSSH: c.useSSH,
    sshHost: c.sshHost,
    sshPort: c.sshPort,
    sshUsername: c.sshUsername,
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
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    hasPassword: !!s.passwordCipher,
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
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    password: decryptSecret(s.passwordCipher) ?? undefined,
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
      if (conn.sshPassword === undefined) next.sshPasswordCipher = prev.sshPasswordCipher
      if (conn.sshPrivateKey === undefined) next.sshPrivateKeyCipher = prev.sshPrivateKeyCipher
      if (conn.sshPassphrase === undefined) next.sshPassphraseCipher = prev.sshPassphraseCipher
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
  }
}
