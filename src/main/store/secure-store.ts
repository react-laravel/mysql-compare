// Electron 桌面端使用 safeStorage；Web 服务端使用显式配置密钥的 AES-GCM。
// 无安全密钥或 safeStorage 时拒绝存储，旧版无前缀密文只尝试 safeStorage 解密。
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { getSafeStorage, isElectronRuntime } from '../platform/electron-runtime'

const ELECTRON_CIPHER_PREFIX = 'electron:'
const NODE_CIPHER_PREFIX = 'node:'
const NODE_SECRET_SALT = 'mysql-compare-web'

function getNodeSecret(): string {
  const configured = process.env['MYSQL_COMPARE_SECRET']?.trim() || process.env['WEB_SECRET_KEY']?.trim()
  if (configured) return configured
  throw new Error('MYSQL_COMPARE_SECRET is required in web runtime; refusing to use a built-in encryption key')
}

export function assertNodeSecretConfigured(): void {
  if (isElectronRuntime()) return
  void getNodeSecret()
}

function encryptForNodeRuntime(plain: string): string {
  const key = scryptSync(getNodeSecret(), NODE_SECRET_SALT, 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${NODE_CIPHER_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

function decryptForNodeRuntime(payload: string): string | null {
  const [ivBase64, tagBase64, encryptedBase64] = payload.split(':')
  if (!ivBase64 || !tagBase64 || !encryptedBase64) return null

  try {
    const key = scryptSync(getNodeSecret(), NODE_SECRET_SALT, 32)
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivBase64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagBase64, 'base64'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, 'base64')),
      decipher.final()
    ])
    return decrypted.toString('utf8')
  } catch (err) {
    console.error('[secure-store] node decrypt failed', err)
    return null
  }
}

function decryptElectronCipher(payload: string): string | null {
  const safeStorage = getSafeStorage()
  if (!safeStorage?.isEncryptionAvailable()) {
    console.error('[secure-store] electron cipher is not readable outside Electron safeStorage runtime')
    return null
  }

  try {
    return safeStorage.decryptString(Buffer.from(payload, 'base64'))
  } catch (err) {
    console.error('[secure-store] electron decrypt failed', err)
    return null
  }
}

function decryptLegacyCipher(cipher: string): string | null {
  const safeStorage = getSafeStorage()
  if (safeStorage?.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
    } catch (err) {
      console.error('[secure-store] legacy safeStorage decrypt failed', err)
      return null
    }
  }

  console.error('[secure-store] refusing to decode a legacy base64-only secret without safeStorage')
  return null
}

/** 使用系统安全存储或 Web 服务端 AES-GCM 加密敏感字段。 */
export function encryptSecret(plain: string | undefined | null): string | null {
  if (plain == null || plain === '') return null
  const safeStorage = getSafeStorage()
  if (safeStorage?.isEncryptionAvailable()) {
    return `${ELECTRON_CIPHER_PREFIX}${safeStorage.encryptString(plain).toString('base64')}`
  }

  if (!isElectronRuntime()) {
    return encryptForNodeRuntime(plain)
  }

  throw new Error('Electron safeStorage is unavailable; refusing to store the secret without encryption')
}

export function decryptSecret(cipher: string | null | undefined): string | null {
  if (cipher == null || cipher === '') return null
  if (cipher.startsWith(ELECTRON_CIPHER_PREFIX)) {
    return decryptElectronCipher(cipher.slice(ELECTRON_CIPHER_PREFIX.length))
  }
  if (cipher.startsWith(NODE_CIPHER_PREFIX)) {
    return decryptForNodeRuntime(cipher.slice(NODE_CIPHER_PREFIX.length))
  }
  return decryptLegacyCipher(cipher)
}
