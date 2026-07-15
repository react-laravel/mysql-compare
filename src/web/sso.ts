import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Request, RequestHandler } from 'express'
import type { WebSecurityConfig } from './security'

const SSO_AUTH_COOKIE = 'mysql_compare_auth'
const TOKEN_VERSION = 1
const requestIdentities = new WeakMap<Request, SsoIdentity>()

export interface SsoIdentity {
  id: number
  name: string
  email: string | null
  is_admin: boolean
  permissions: string[]
}

interface SsoAuthPayload extends SsoIdentity {
  version: number
  expiresAt: number
  sessionId: string
}

interface SsoExchangeEnvelope {
  success?: boolean
  message?: string
  data?: {
    identity?: unknown
  }
}

export function buildSsoProviderUrl(config: WebSecurityConfig, returnTo?: string): string {
  const sso = requireSsoConfig(config)
  const url = new URL(`/auth/sso/${encodeURIComponent(sso.client)}`, sso.accountUrl)
  url.searchParams.set('return_to', normalizeSsoReturnTo(config, returnTo))
  return url.toString()
}

export function normalizeSsoReturnTo(config: WebSecurityConfig, returnTo?: string): string {
  const publicUrl = new URL(requireSsoConfig(config).publicUrl)
  if (!returnTo) return publicUrl.toString()

  try {
    const resolved = new URL(returnTo, publicUrl)
    if (resolved.origin !== publicUrl.origin) return publicUrl.toString()
    return resolved.toString()
  } catch {
    return publicUrl.toString()
  }
}

export async function exchangeSsoTicket(
  config: WebSecurityConfig,
  ticket: string
): Promise<SsoIdentity> {
  const sso = requireSsoConfig(config)
  if (!/^[0-9a-f]{64}$/iu.test(ticket)) throw new Error('Invalid SSO ticket')

  const response = await fetch(new URL('/api/auth/sso/exchange', sso.apiUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-SSO-Client-Secret': sso.clientSecret
    },
    body: JSON.stringify({ client: sso.client, ticket }),
    signal: AbortSignal.timeout(5000)
  })

  const body = (await response.json().catch(() => null)) as SsoExchangeEnvelope | null
  if (!response.ok || !body?.success) {
    throw new Error(body?.message || 'SSO ticket exchange failed')
  }

  const identity = normalizeIdentity(body.data?.identity)
  if (!identity?.is_admin) throw new Error('MySQL Compare is restricted to administrators')
  return identity
}

export function createSsoAuthCookie(
  config: WebSecurityConfig,
  identity: SsoIdentity,
  now = Date.now()
): string {
  const sso = requireSsoConfig(config)
  const payload: SsoAuthPayload = {
    ...identity,
    version: TOKEN_VERSION,
    expiresAt: Math.floor(now / 1000) + sso.sessionTtlSeconds,
    sessionId: randomUUID()
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = sign(encoded, config.sessionSecret)
  const secure = config.secureCookies ? '; Secure' : ''

  return `${SSO_AUTH_COOKIE}=${encoded}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sso.sessionTtlSeconds}${secure}`
}

export function verifySsoAuthToken(
  config: WebSecurityConfig,
  token: string,
  now = Date.now()
): SsoIdentity | null {
  const separator = token.lastIndexOf('.')
  if (separator < 1) return null

  const encoded = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  if (!safeEqual(signature, sign(encoded, config.sessionSecret))) return null

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SsoAuthPayload
    if (
      payload.version !== TOKEN_VERSION ||
      !Number.isInteger(payload.expiresAt) ||
      payload.expiresAt <= Math.floor(now / 1000) ||
      !isUUID(payload.sessionId)
    ) {
      return null
    }

    return normalizeIdentity(payload)
  } catch {
    return null
  }
}

export function requireSsoAuthentication(config: WebSecurityConfig): RequestHandler {
  requireSsoConfig(config)

  return (req, res, next) => {
    const token = getCookie(req.get('cookie'), SSO_AUTH_COOKIE)
    const identity = token ? verifySsoAuthToken(config, token) : null
    if (identity) {
      requestIdentities.set(req, identity)
      next()
      return
    }

    const returnTo = req.originalUrl?.startsWith('/') ? req.originalUrl : '/'
    const loginUrl = `/auth/login?return_to=${encodeURIComponent(returnTo)}`
    const acceptsHtml = (req.get('accept') || '').includes('text/html')
    if ((req.method === 'GET' || req.method === 'HEAD') && acceptsHtml && !req.path.startsWith('/api')) {
      res.redirect(302, loginUrl)
      return
    }

    res.status(401).json({
      ok: false,
      error: 'Authentication required',
      login_url: loginUrl
    })
  }
}

export function getSsoIdentity(req: Request): SsoIdentity {
  const identity = requestIdentities.get(req)
  if (!identity) throw new Error('Authenticated SSO identity is required')
  return identity
}

function requireSsoConfig(config: WebSecurityConfig): NonNullable<WebSecurityConfig['sso']> {
  if (config.authMode !== 'sso' || !config.sso) {
    throw new Error('SSO authentication is not configured')
  }
  return config.sso
}

function normalizeIdentity(value: unknown): SsoIdentity | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<SsoIdentity>
  if (
    !Number.isInteger(candidate.id) ||
    Number(candidate.id) < 1 ||
    typeof candidate.name !== 'string' ||
    candidate.name.length < 1 ||
    typeof candidate.is_admin !== 'boolean'
  ) {
    return null
  }

  return {
    id: Number(candidate.id),
    name: candidate.name,
    email: typeof candidate.email === 'string' ? candidate.email : null,
    is_admin: candidate.is_admin,
    permissions: Array.isArray(candidate.permissions)
      ? candidate.permissions.filter((permission): permission is string => typeof permission === 'string')
      : []
  }
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
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

function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}
