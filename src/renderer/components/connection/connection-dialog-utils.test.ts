import { describe, expect, it } from 'vitest'
import type { ConnectionConfig, SafeConnection } from '../../../shared/types'
import {
  buildPayload,
  createInitialForm,
  DEFAULT_PORT,
  parsePortValue,
  validateConnectionForm
} from './connection-dialog-utils'

function createForm(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1',
    engine: 'mysql',
    name: 'Primary',
    group: 'Ops',
    host: '127.0.0.1',
    port: DEFAULT_PORT.mysql,
    username: 'root',
    password: 'secret',
    database: 'app_db',
    useSSH: false,
    sshHost: '',
    sshPort: 22,
    sshUsername: '',
    sshPassword: '',
    sshPrivateKey: '',
    sshPassphrase: '',
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  }
}

describe('connection-dialog-utils', () => {
  it('creates mysql defaults for a new connection form', () => {
    expect(createInitialForm()).toEqual({
      id: '',
      engine: 'mysql',
      name: '',
      group: '',
      host: '127.0.0.1',
      port: DEFAULT_PORT.mysql,
      username: 'root',
      password: '',
      database: '',
      useSSH: false,
      sshHost: '',
      sshPort: 22,
      sshUsername: '',
      sshPassword: '',
      sshPrivateKey: '',
      sshPassphrase: '',
      createdAt: 0,
      updatedAt: 0
    })
  })

  it('creates redis defaults without requiring a username', () => {
    const form = createInitialForm({
      id: 'redis-1',
      engine: 'redis',
      name: 'Cache',
      host: '127.0.0.1',
      port: DEFAULT_PORT.redis,
      username: '',
      database: '0',
      useSSH: false,
      createdAt: 1,
      updatedAt: 2,
      hasPassword: false,
      hasSSHPassword: false,
      hasSSHPrivateKey: false
    })

    expect(form.port).toBe(DEFAULT_PORT.redis)
    expect(form.username).toBe('')
    expect(validateConnectionForm(form)).toBeNull()
  })

  it('hydrates an existing connection without exposing stored secrets', () => {
    const savedConnection: SafeConnection = {
      id: 'conn-2',
      engine: 'postgres',
      name: 'Analytics',
      group: 'BI',
      host: 'pg.internal',
      port: 5433,
      username: 'analyst',
      database: 'warehouse',
      useSSH: true,
      sshHost: 'bastion.internal',
      sshPort: 2222,
      sshUsername: 'deploy',
      createdAt: 10,
      updatedAt: 20,
      hasPassword: true,
      hasSSHPassword: true,
      hasSSHPrivateKey: true
    }

    expect(createInitialForm(savedConnection)).toEqual({
      id: savedConnection.id,
      engine: savedConnection.engine,
      name: savedConnection.name,
      group: savedConnection.group,
      host: savedConnection.host,
      port: savedConnection.port,
      username: savedConnection.username,
      database: savedConnection.database,
      useSSH: savedConnection.useSSH,
      sshHost: savedConnection.sshHost,
      sshPort: savedConnection.sshPort,
      sshUsername: savedConnection.sshUsername,
      password: '',
      sshPassword: '',
      sshPrivateKey: '',
      sshPassphrase: '',
      createdAt: savedConnection.createdAt,
      updatedAt: 0
    })
  })

  it('trims direct connection fields and clears SSH-only values when SSH is disabled', () => {
    const payload = buildPayload(
      createForm({
        name: ' Primary ',
        group: ' Ops ',
        host: ' db.internal ',
        username: ' admin ',
        database: ' app_db ',
        password: '',
        useSSH: false,
        sshHost: ' bastion ',
        sshUsername: ' deploy ',
        sshPassword: 'secret',
        sshPrivateKey: ' key ',
        sshPassphrase: ' pass '
      })
    )

    expect(payload).toMatchObject({
      name: 'Primary',
      group: 'Ops',
      host: 'db.internal',
      username: 'admin',
      database: 'app_db',
      password: undefined,
      sshHost: undefined,
      sshUsername: undefined,
      sshPassword: undefined,
      sshPrivateKey: undefined,
      sshPassphrase: undefined
    })
  })

  it('trims and preserves SSH credentials only when SSH is enabled', () => {
    const payload = buildPayload(
      createForm({
        useSSH: true,
        sshHost: ' bastion ',
        sshUsername: ' deploy ',
        sshPassword: '',
        sshPrivateKey: '  PRIVATE KEY  ',
        sshPassphrase: 'phrase'
      })
    )

    expect(payload.sshHost).toBe('bastion')
    expect(payload.sshUsername).toBe('deploy')
    expect(payload.sshPassword).toBeUndefined()
    expect(payload.sshPrivateKey).toBe('PRIVATE KEY')
    expect(payload.sshPassphrase).toBe('phrase')
  })

  it('accepts a valid direct connection form', () => {
    expect(validateConnectionForm(createForm())).toBeNull()
  })

  it('requires SSH authentication details when an SSH tunnel is enabled', () => {
    expect(
      validateConnectionForm(
        createForm({
          useSSH: true,
          sshHost: 'bastion',
          sshUsername: 'deploy',
          sshPassword: '',
          sshPrivateKey: '   '
        })
      )
    ).toBe('SSH password or private key is required when SSH tunnel is enabled')
  })

  it('validates direct and SSH port ranges', () => {
    expect(validateConnectionForm(createForm({ port: 0 }))).toBe(
      'Port must be between 1 and 65535'
    )
    expect(
      validateConnectionForm(
        createForm({
          useSSH: true,
          sshHost: 'bastion',
          sshUsername: 'deploy',
          sshPassword: 'secret',
          sshPort: 70000
        })
      )
    ).toBe('SSH port must be between 1 and 65535')
  })

  it('parses port input strings with fallback behavior', () => {
    expect(parsePortValue('3307', DEFAULT_PORT.mysql)).toBe(3307)
    expect(parsePortValue('', DEFAULT_PORT.mysql)).toBe(DEFAULT_PORT.mysql)
    expect(parsePortValue('33.5', DEFAULT_PORT.mysql)).toBe(DEFAULT_PORT.mysql)
    expect(parsePortValue('abc', DEFAULT_PORT.mysql)).toBe(DEFAULT_PORT.mysql)
  })
})