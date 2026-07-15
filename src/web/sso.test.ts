import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { loadWebSecurityConfig } from './security'
import {
  buildSsoProviderUrl,
  createSsoAuthCookie,
  exchangeSsoTicket,
  normalizeSsoReturnTo,
  requireSsoAuthentication,
  verifySsoAuthToken,
  type SsoIdentity
} from './sso'

const identity: SsoIdentity = {
  id: 42,
  name: 'Sam',
  email: 'sam@example.com',
  is_admin: true,
  permissions: ['admin']
}

describe('web SSO', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('loads SSO mode without Basic credentials and validates service URLs', () => {
    const config = createConfig()
    expect(config.authMode).toBe('sso')
    expect(config.sso?.client).toBe('mysql-compare')

    expect(() => loadWebSecurityConfig({
      ...createEnvironment(),
      MYSQL_COMPARE_SSO_ACCOUNT_URL: 'http://next.example.com'
    })).toThrow('must use HTTPS outside loopback')
  })

  it('builds the central login URL and rejects external return targets', () => {
    const config = createConfig()
    const providerUrl = new URL(buildSsoProviderUrl(config, '/databases?tab=users'))

    expect(providerUrl.origin).toBe('https://next.dogeow.com')
    expect(providerUrl.pathname).toBe('/auth/sso/mysql-compare')
    expect(providerUrl.searchParams.get('return_to')).toBe(
      'https://mysql-compare.dogeow.com/databases?tab=users'
    )
    expect(normalizeSsoReturnTo(config, 'https://attacker.example/steal')).toBe(
      'https://mysql-compare.dogeow.com/'
    )
  })

  it('creates a signed expiring administrator session cookie', () => {
    const config = createConfig()
    const now = Date.UTC(2026, 6, 15, 10, 0, 0)
    const cookie = createSsoAuthCookie(config, identity, now)
    const token = cookie.match(/^mysql_compare_auth=([^;]+)/u)?.[1]

    expect(cookie).toContain('HttpOnly; SameSite=Lax')
    expect(cookie).toContain('; Secure')
    expect(token).toBeTruthy()
    expect(verifySsoAuthToken(config, token!, now + 1000)).toEqual(identity)
    expect(verifySsoAuthToken(config, token!, now + 28_801_000)).toBeNull()
    expect(verifySsoAuthToken(config, `${token}forged`, now)).toBeNull()
  })

  it('redirects HTML requests to SSO and returns JSON for unauthenticated APIs', () => {
    const config = createConfig()
    const middleware = requireSsoAuthentication(config)
    const browserResponse = createResponse()

    middleware(
      createRequest({ accept: 'text/html' }, 'GET', '/databases?tab=users'),
      browserResponse.response,
      vi.fn()
    )
    expect(browserResponse.redirect).toHaveBeenCalledWith(
      302,
      '/auth/login?return_to=%2Fdatabases%3Ftab%3Dusers'
    )

    const apiResponse = createResponse()
    middleware(
      createRequest({ accept: 'application/json' }, 'GET', '/api/session'),
      apiResponse.response,
      vi.fn()
    )
    expect(apiResponse.status).toHaveBeenCalledWith(401)
    expect(apiResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      login_url: '/auth/login?return_to=%2Fapi%2Fsession'
    }))
  })

  it('accepts a valid SSO cookie', () => {
    const config = createConfig()
    const cookie = createSsoAuthCookie(config, identity).split(';', 1)[0]!
    const next = vi.fn()

    requireSsoAuthentication(config)(
      createRequest({ cookie, accept: 'application/json' }, 'GET', '/api/session'),
      createResponse().response,
      next
    )

    expect(next).toHaveBeenCalledTimes(1)
  })

  it('exchanges a ticket server-to-server and requires an administrator identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { identity }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeSsoTicket(createConfig(), 'a'.repeat(64))).resolves.toEqual(identity)
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://next-api.dogeow.com/api/auth/sso/exchange'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-SSO-Client-Secret': 's'.repeat(32)
        })
      })
    )

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      data: { identity: { ...identity, is_admin: false, permissions: [] } }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
    await expect(exchangeSsoTicket(createConfig(), 'b'.repeat(64))).rejects.toThrow(
      'restricted to administrators'
    )
  })
})

function createConfig() {
  return loadWebSecurityConfig(createEnvironment())
}

function createEnvironment(): NodeJS.ProcessEnv {
  return {
    MYSQL_COMPARE_WEB_AUTH_MODE: 'sso',
    MYSQL_COMPARE_SECRET: 'long-test-session-secret',
    MYSQL_COMPARE_WEB_HOST: '127.0.0.1',
    MYSQL_COMPARE_WEB_PORT: '3006',
    MYSQL_COMPARE_ALLOWED_ORIGINS: 'https://mysql-compare.dogeow.com',
    MYSQL_COMPARE_PUBLIC_URL: 'https://mysql-compare.dogeow.com',
    MYSQL_COMPARE_SSO_ACCOUNT_URL: 'https://next.dogeow.com',
    MYSQL_COMPARE_SSO_API_URL: 'https://next-api.dogeow.com',
    MYSQL_COMPARE_SSO_CLIENT: 'mysql-compare',
    MYSQL_COMPARE_SSO_CLIENT_SECRET: 's'.repeat(32),
    MYSQL_COMPARE_SSO_SESSION_TTL_SECONDS: '28800'
  }
}

function createRequest(
  headers: Record<string, string>,
  method = 'GET',
  originalUrl = '/'
): Request {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  )
  return {
    method,
    originalUrl,
    path: originalUrl.split('?', 1)[0],
    get: (name: string) => normalized[name.toLowerCase()]
  } as unknown as Request
}

function createResponse() {
  const status = vi.fn()
  const json = vi.fn()
  const redirect = vi.fn()
  const response = {
    redirect,
    status: (code: number) => {
      status(code)
      return response
    },
    json
  } as unknown as Response
  return { response, status, json, redirect }
}
