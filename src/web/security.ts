import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Request, RequestHandler, Response } from 'express'

const WEB_SESSION_COOKIE = 'mysql_compare_session'
const requestSessionIds = new WeakMap<Request, string>()

export interface WebSecurityConfig {
  authMode: 'basic' | 'sso'
  username: string
  password: string
  host: string
  port: number
  allowedOrigins: Set<string>
  sessionSecret: string
  secureCookies: boolean
  sso: {
    accountUrl: string
    apiUrl: string
    client: string
    clientSecret: string
    publicUrl: string
    sessionTtlSeconds: number
  } | null
}

export function loadWebSecurityConfig(
  env: NodeJS.ProcessEnv = process.env
): WebSecurityConfig {
  const authMode = (env['MYSQL_COMPARE_WEB_AUTH_MODE']?.trim().toLowerCase() || 'basic') as
    | 'basic'
    | 'sso'
  if (authMode !== 'basic' && authMode !== 'sso') {
    throw new Error('MYSQL_COMPARE_WEB_AUTH_MODE must be basic or sso')
  }

  const username = env['MYSQL_COMPARE_WEB_USERNAME']?.trim() || ''
  const password = env['MYSQL_COMPARE_WEB_PASSWORD'] ?? ''
  const host = env['MYSQL_COMPARE_WEB_HOST']?.trim() || '127.0.0.1'
  const port = Number(env['PORT'] || env['MYSQL_COMPARE_WEB_PORT'] || 3000)
  const sessionSecret = env['MYSQL_COMPARE_SECRET']?.trim() || env['WEB_SECRET_KEY']?.trim()

  if (authMode === 'basic') {
    if (!username) throw new Error('MYSQL_COMPARE_WEB_USERNAME is required')
    if (password.length < 12) {
      throw new Error('MYSQL_COMPARE_WEB_PASSWORD must contain at least 12 characters')
    }
  }
  if (!sessionSecret) {
    throw new Error('MYSQL_COMPARE_SECRET is required in web runtime')
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MYSQL_COMPARE_WEB_PORT must be a valid TCP port')
  }

  const configuredOrigins = (env['MYSQL_COMPARE_ALLOWED_ORIGINS'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const loopback = isLoopbackHost(host)
  if (!loopback && configuredOrigins.length === 0) {
    throw new Error('MYSQL_COMPARE_ALLOWED_ORIGINS is required when the web server is not bound to loopback')
  }

  const normalizedConfiguredOrigins = configuredOrigins.map((value) => {
    const origin = normalizeOrigin(value)
    if (!origin) throw new Error(`Invalid origin in MYSQL_COMPARE_ALLOWED_ORIGINS: ${value}`)
    const parsed = new URL(origin)
    if (!isLoopbackHost(parsed.hostname) && parsed.protocol !== 'https:') {
      throw new Error('Non-loopback MYSQL_COMPARE_ALLOWED_ORIGINS entries must use HTTPS')
    }
    return origin
  })
  const allowedOrigins = new Set(normalizedConfiguredOrigins)
  if (loopback) {
    allowedOrigins.add(`http://127.0.0.1:${port}`)
    allowedOrigins.add(`http://localhost:${port}`)
  }

  const secureCookies =
    !loopback || normalizedConfiguredOrigins.some((origin) => new URL(origin).protocol === 'https:')
  const sso = authMode === 'sso' ? loadSsoConfig(env) : null

  return {
    authMode,
    username,
    password,
    host,
    port,
    allowedOrigins,
    sessionSecret,
    secureCookies,
    sso
  }
}

export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    next()
  }
}

export function requireBasicAuth(config: WebSecurityConfig): RequestHandler {
  return (req, res, next) => {
    const credentials = parseBasicAuthorization(req.get('authorization'))
    if (
      credentials &&
      safeEqual(credentials.username, config.username) &&
      safeEqual(credentials.password, config.password)
    ) {
      next()
      return
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="MySQL Compare", charset="UTF-8"')
    sendSecurityError(res, 401, 'Authentication required')
  }
}

export function establishWebSession(config: WebSecurityConfig): RequestHandler {
  return (req, res, next) => {
    const token = getCookie(req.get('cookie'), WEB_SESSION_COOKIE)
    const verifiedSessionId = token ? verifySessionToken(token, config.sessionSecret) : null
    const sessionId = verifiedSessionId ?? randomUUID()

    requestSessionIds.set(req, sessionId)
    if (!verifiedSessionId) {
      const secure = config.secureCookies ? '; Secure' : ''
      res.setHeader(
        'Set-Cookie',
        `${WEB_SESSION_COOKIE}=${createSessionToken(sessionId, config.sessionSecret)}; Path=/; HttpOnly; SameSite=Strict${secure}`
      )
    }
    next()
  }
}

export function requireMutationProtection(config: WebSecurityConfig): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next()
      return
    }

    const origin = req.get('origin')
    const fetchSite = req.get('sec-fetch-site')
    if (!origin || !config.allowedOrigins.has(normalizeOrigin(origin)) || fetchSite === 'cross-site') {
      sendSecurityError(res, 403, 'Cross-origin request rejected')
      return
    }

    const contentType = req.get('content-type')
    if (contentType && !contentType.toLowerCase().startsWith('application/json')) {
      sendSecurityError(res, 415, 'Only application/json requests are accepted')
      return
    }

    next()
  }
}

export function getRequestSessionId(req: Request): string {
  const sessionId = requestSessionIds.get(req)
  if (!sessionId) throw new Error('Authenticated web session is required')
  return sessionId
}

export function parseBasicAuthorization(
  authorization: string | undefined
): { username: string; password: string } | null {
  const match = authorization?.match(/^Basic\s+(.+)$/iu)
  if (!match?.[1]) return null
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator < 0) return null
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    }
  } catch {
    return null
  }
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function createSessionToken(sessionId: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(sessionId).digest('base64url')
  return `${sessionId}.${signature}`
}

function verifySessionToken(token: string, secret: string): string | null {
  const separator = token.indexOf('.')
  if (separator < 0) return null

  const sessionId = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  if (!isUUID(sessionId) || !signature) return null

  const expected = createHmac('sha256', secret).update(sessionId).digest('base64url')
  return safeEqual(signature, expected) ? sessionId : null
}

function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

function getCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    return part.slice(separator + 1).trim() || undefined
  }
  return undefined
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function loadSsoConfig(env: NodeJS.ProcessEnv): NonNullable<WebSecurityConfig['sso']> {
  const clientSecret = env['MYSQL_COMPARE_SSO_CLIENT_SECRET']?.trim() || ''
  if (clientSecret.length < 32) {
    throw new Error('MYSQL_COMPARE_SSO_CLIENT_SECRET must contain at least 32 characters')
  }

  const publicUrl = requireSecureServiceUrl(
    env['MYSQL_COMPARE_PUBLIC_URL'],
    'MYSQL_COMPARE_PUBLIC_URL'
  )
  const accountUrl = requireSecureServiceUrl(
    env['MYSQL_COMPARE_SSO_ACCOUNT_URL'],
    'MYSQL_COMPARE_SSO_ACCOUNT_URL'
  )
  const apiUrl = requireSecureServiceUrl(
    env['MYSQL_COMPARE_SSO_API_URL'],
    'MYSQL_COMPARE_SSO_API_URL'
  )
  const client = env['MYSQL_COMPARE_SSO_CLIENT']?.trim() || 'mysql-compare'
  const configuredTtl = Number(env['MYSQL_COMPARE_SSO_SESSION_TTL_SECONDS'] || 28800)
  if (!Number.isInteger(configuredTtl) || configuredTtl < 300 || configuredTtl > 86400) {
    throw new Error('MYSQL_COMPARE_SSO_SESSION_TTL_SECONDS must be between 300 and 86400')
  }

  return {
    accountUrl,
    apiUrl,
    client,
    clientSecret,
    publicUrl,
    sessionTtlSeconds: configuredTtl
  }
}

function requireSecureServiceUrl(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required in SSO mode`)

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid URL`)
  }

  if (url.protocol !== 'https:' && !isLoopbackHost(url.hostname)) {
    throw new Error(`${name} must use HTTPS outside loopback`)
  }

  return url.origin
}

function sendSecurityError(res: Response, status: number, message: string): void {
  res.status(status).json({ ok: false, error: message })
}
