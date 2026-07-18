import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionConfig } from '../../../shared/types'

const { Client, Pool } = vi.hoisted(() => ({
  Client: vi.fn(),
  Pool: vi.fn()
}))

vi.mock('pg', () => ({
  default: {
    Client,
    Pool
  },
  Client,
  Pool
}))

import { PostgresDriver } from './pg-driver'

describe('PostgresDriver', () => {
  beforeEach(() => {
    Client.mockReset()
    Pool.mockReset()
    // Vitest 4 + Vite SSR: use classic functions so `new pg.Client()` works.
    Client.mockImplementation(function MockClient(this: {
      connect: ReturnType<typeof vi.fn>
      query: ReturnType<typeof vi.fn>
      end: ReturnType<typeof vi.fn>
    }) {
      this.connect = vi.fn(async () => undefined)
      this.query = vi.fn(async () => ({ rows: [{ server_version: '16.4' }] }))
      this.end = vi.fn(async () => undefined)
    })
    Pool.mockImplementation(function MockPool(this: {
      query: ReturnType<typeof vi.fn>
      end: ReturnType<typeof vi.fn>
    }) {
      this.query = vi.fn(async () => ({ rows: [{ table_name: 'users' }] }))
      this.end = vi.fn(async () => undefined)
    })
  })

  it('passes an empty string password to pg when no password is configured', async () => {
    const driver = new PostgresDriver({
      connection: createConnectionConfig({ password: undefined })
    })

    await expect(driver.testConnection()).resolves.toBe('OK · PostgreSQL 16.4')
    await expect(driver.listTables('analytics')).resolves.toEqual(['users'])

    expect(Client).toHaveBeenCalledWith(expect.objectContaining({ password: '' }))
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({ password: '' }))
  })

  it('passes configured passwords through unchanged', async () => {
    const driver = new PostgresDriver({
      connection: createConnectionConfig({ password: 'secret' })
    })

    await driver.testConnection()

    expect(Client).toHaveBeenCalledWith(expect.objectContaining({ password: 'secret' }))
  })

  it('only lists databases the current user can connect to', async () => {
    const query = vi.fn(async () => ({
      rows: [{ datname: 'app_a' }, { datname: 'app_b' }]
    }))
    Client.mockImplementation(function MockClient(this: {
      connect: ReturnType<typeof vi.fn>
      query: ReturnType<typeof vi.fn>
      end: ReturnType<typeof vi.fn>
    }) {
      this.connect = vi.fn(async () => undefined)
      this.query = query
      this.end = vi.fn(async () => undefined)
    })
    const driver = new PostgresDriver({
      connection: createConnectionConfig({ username: 'app_user', password: 'secret' })
    })

    await expect(driver.listDatabases()).resolves.toEqual(['app_a', 'app_b'])

    expect(query).toHaveBeenCalledWith(expect.stringContaining("has_database_privilege(datname, 'CONNECT')"))
  })

  it('uses database-specific credentials when opening a database pool', async () => {
    const driver = new PostgresDriver({
      connection: createConnectionConfig({
        username: 'server_user',
        password: 'server_secret',
        databaseCredentials: {
          app_db: {
            username: 'app_user',
            password: 'app_secret'
          }
        }
      })
    })

    await expect(driver.listTables('app_db')).resolves.toEqual(['users'])

    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      user: 'app_user',
      password: 'app_secret',
      database: 'app_db'
    }))
  })

  it('tests the selected database with its database-specific credentials', async () => {
    const driver = new PostgresDriver({
      connection: createConnectionConfig({
        database: 'app_db',
        username: 'server_user',
        password: 'server_secret',
        databaseCredentials: {
          app_db: {
            username: 'app_user',
            password: 'app_secret'
          }
        }
      })
    })

    await driver.testConnection()

    expect(Client).toHaveBeenCalledWith(expect.objectContaining({
      user: 'app_user',
      password: 'app_secret',
      database: 'app_db'
    }))
  })

  it('reports a clear error when SCRAM authentication has no database password', async () => {
    Client.mockImplementation(function MockClient(this: {
      connect: ReturnType<typeof vi.fn>
      end: ReturnType<typeof vi.fn>
    }) {
      this.connect = vi.fn(async () => {
        throw new Error('SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a non-empty string')
      })
      this.end = vi.fn(async () => undefined)
    })
    const driver = new PostgresDriver({
      connection: createConnectionConfig({ password: undefined })
    })

    await expect(driver.listDatabases()).rejects.toThrow(
      'PostgreSQL database password is required. The SSH password only opens the tunnel; fill the database password in the connection settings.'
    )
  })
})

function createConnectionConfig(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'pg-1',
    engine: 'postgres',
    name: 'Postgres',
    host: '127.0.0.1',
    port: 5432,
    username: 'postgres',
    database: 'postgres',
    useSSH: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}
