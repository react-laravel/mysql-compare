import { describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'
import {
  establishWebSession,
  getRequestSessionId,
  loadWebSecurityConfig,
  parseBasicAuthorization,
  requireBasicAuth,
  requireMutationProtection
} from './security'

describe('web security', () => {
  it('requires credentials and explicit HTTPS origins for network exposure', () => {
    expect(() => loadWebSecurityConfig({})).toThrow('MYSQL_COMPARE_WEB_USERNAME is required')
    expect(() => loadWebSecurityConfig({
      MYSQL_COMPARE_WEB_USERNAME: 'admin',
      MYSQL_COMPARE_WEB_PASSWORD: 'long-test-password',
      MYSQL_COMPARE_SECRET: 'long-test-session-secret',
      MYSQL_COMPARE_WEB_HOST: '0.0.0.0'
    })).toThrow('MYSQL_COMPARE_ALLOWED_ORIGINS is required')
    expect(() => loadWebSecurityConfig({
      MYSQL_COMPARE_WEB_USERNAME: 'admin',
      MYSQL_COMPARE_WEB_PASSWORD: 'long-test-password',
      MYSQL_COMPARE_SECRET: 'long-test-session-secret',
      MYSQL_COMPARE_WEB_HOST: '0.0.0.0',
      MYSQL_COMPARE_ALLOWED_ORIGINS: 'http://db.example.com'
    })).toThrow('must use HTTPS')
  })

  it('parses Basic credentials without truncating colons in the password', () => {
    const value = Buffer.from('admin:password:with:colons').toString('base64')
    expect(parseBasicAuthorization(`basic ${value}`)).toEqual({
      username: 'admin',
      password: 'password:with:colons'
    })
  })

  it('rejects unauthenticated requests and accepts exact credentials', () => {
    const config = createConfig()
    const middleware = requireBasicAuth(config)
    const rejected = createResponse()
    middleware(createRequest({}), rejected.response, vi.fn())
    expect(rejected.status).toHaveBeenCalledWith(401)
    expect(rejected.setHeader).toHaveBeenCalledWith('WWW-Authenticate', expect.stringContaining('Basic'))

    const acceptedNext = vi.fn()
    const authorization = `Basic ${Buffer.from('admin:long-test-password').toString('base64')}`
    middleware(createRequest({ authorization }), createResponse().response, acceptedNext)
    expect(acceptedNext).toHaveBeenCalledTimes(1)
  })

  it('issues a signed HttpOnly session cookie and reuses it on later requests', () => {
    const middleware = establishWebSession(createConfig())
    const firstRequest = createRequest({})
    const firstResponse = createResponse()
    middleware(firstRequest, firstResponse.response, vi.fn())

    const firstSessionId = getRequestSessionId(firstRequest)
    const setCookie = firstResponse.setHeader.mock.calls.find(([name]) => name === 'Set-Cookie')?.[1]
    expect(setCookie).toEqual(expect.stringContaining('HttpOnly; SameSite=Strict'))

    const cookie = String(setCookie).split(';', 1)[0]!
    const secondRequest = createRequest({ cookie })
    const secondResponse = createResponse()
    middleware(secondRequest, secondResponse.response, vi.fn())

    expect(getRequestSessionId(secondRequest)).toBe(firstSessionId)
    expect(secondResponse.setHeader).not.toHaveBeenCalledWith('Set-Cookie', expect.anything())
  })

  it('marks session cookies Secure when an external HTTPS origin is configured', () => {
    const config = loadWebSecurityConfig({
      MYSQL_COMPARE_WEB_USERNAME: 'admin',
      MYSQL_COMPARE_WEB_PASSWORD: 'long-test-password',
      MYSQL_COMPARE_SECRET: 'long-test-session-secret',
      MYSQL_COMPARE_WEB_HOST: '127.0.0.1',
      MYSQL_COMPARE_ALLOWED_ORIGINS: 'https://db.example.com'
    })
    const response = createResponse()

    establishWebSession(config)(createRequest({}), response.response, vi.fn())

    expect(response.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('; Secure'))
  })

  it('replaces a forged session cookie instead of accepting its claimed owner', () => {
    const middleware = establishWebSession(createConfig())
    const claimedSessionId = '123e4567-e89b-42d3-a456-426614174000'
    const request = createRequest({
      cookie: `mysql_compare_session=${claimedSessionId}.forged-signature`
    })

    middleware(request, createResponse().response, vi.fn())

    expect(getRequestSessionId(request)).not.toBe(claimedSessionId)
  })

  it('requires same-origin JSON mutations after authentication', () => {
    const config = createConfig()
    const middleware = requireMutationProtection(config)
    const next = vi.fn()
    middleware(createRequest({
      origin: 'http://127.0.0.1:3000',
      'content-type': 'application/json'
    }, 'POST'), createResponse().response, next)
    expect(next).toHaveBeenCalledTimes(1)

    const crossOrigin = createResponse()
    middleware(createRequest({
      origin: 'https://attacker.example',
      'content-type': 'application/json'
    }, 'POST'), crossOrigin.response, vi.fn())
    expect(crossOrigin.status).toHaveBeenCalledWith(403)

    const wrongContentType = createResponse()
    middleware(createRequest({
      origin: 'http://127.0.0.1:3000',
      'content-type': 'text/plain'
    }, 'DELETE'), wrongContentType.response, vi.fn())
    expect(wrongContentType.status).toHaveBeenCalledWith(415)
  })
})

function createConfig() {
  return loadWebSecurityConfig({
    MYSQL_COMPARE_WEB_USERNAME: 'admin',
    MYSQL_COMPARE_WEB_PASSWORD: 'long-test-password',
    MYSQL_COMPARE_SECRET: 'long-test-session-secret',
    MYSQL_COMPARE_WEB_HOST: '127.0.0.1',
    MYSQL_COMPARE_WEB_PORT: '3000'
  })
}

function createRequest(headers: Record<string, string>, method = 'GET'): Request {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  return {
    method,
    get: (name: string) => normalized[name.toLowerCase()]
  } as unknown as Request
}

function createResponse() {
  const status = vi.fn()
  const json = vi.fn()
  const setHeader = vi.fn()
  const response = {
    setHeader,
    status: (code: number) => {
      status(code)
      return response
    },
    json
  } as unknown as Response
  return { response, status, json, setHeader }
}
