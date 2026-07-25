import { describe, expect, it } from 'vitest'
import type { ConnectionConfig, SafeConnection } from '../../../shared/types'
import {
  buildPayload,
  createInitialForm,
  DEFAULT_PORT,
  getInitialSSHAuthMethod,
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
    sshPrivateKeyPath: '',
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
      sshPrivateKeyPath: '',
      sshPassphrase: '',
      sshSourceConnectionId: undefined,
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
      sshPrivateKeyPath: '/Users/sam/.ssh/id_rsa',
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
      sshPrivateKeyPath: '/Users/sam/.ssh/id_rsa',
      sshPassphrase: '',
      sshSourceConnectionId: undefined,
      createdAt: savedConnection.createdAt,
      updatedAt: 0
    })
  })

  it('creates PostgreSQL defaults while reusing an SSH connection', () => {
    const sshSource: SafeConnection = {
      id: 'ssh-source',
      engine: 'mysql',
      name: 'DogeOW',
      group: 'Production',
      host: '127.0.0.1',
      port: 3306,
      username: 'root',
      useSSH: true,
      sshHost: 'server.example.com',
      sshPort: 22,
      sshUsername: 'ubuntu',
      createdAt: 1,
      updatedAt: 2,
      hasPassword: true,
      hasSSHPassword: false,
      hasSSHPrivateKey: true
    }

    expect(createInitialForm(null, sshSource)).toMatchObject({
      id: '',
      engine: 'postgres',
      group: 'Production',
      host: '127.0.0.1',
      port: DEFAULT_PORT.postgres,
      username: 'postgres',
      useSSH: true,
      sshHost: 'server.example.com',
      sshPort: 22,
      sshUsername: 'ubuntu',
      sshSourceConnectionId: 'ssh-source'
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
      }),
      'privateKey'
    )

    expect(payload.sshHost).toBe('bastion')
    expect(payload.sshUsername).toBe('deploy')
    expect(payload.sshPassword).toBe('')
    expect(payload.sshPrivateKey).toBe('PRIVATE KEY')
    expect(payload.sshPassphrase).toBe('phrase')
  })

  it('persists ssh private key path when SSH is enabled', () => {
    const payload = buildPayload(
      createForm({
        useSSH: true,
        sshHost: 'bastion',
        sshUsername: 'deploy',
        sshPassword: 'secret',
        sshPrivateKeyPath: ' /Users/sam/.ssh/id_rsa '
      }),
      'privateKey'
    )

    expect(payload.sshPrivateKeyPath).toBe('/Users/sam/.ssh/id_rsa')
  })

  it('accepts a valid direct connection form', () => {
    expect(validateConnectionForm(createForm())).toBeNull()
  })

  it('uses the trimmed host as the name when the name is empty', () => {
    const form = createForm({ name: '   ', host: ' 192.168.1.10 ' })

    expect(validateConnectionForm(form)).toBeNull()
    expect(buildPayload(form)).toMatchObject({
      name: '192.168.1.10',
      host: '192.168.1.10'
    })
  })

  it('requires SSH authentication details when an SSH tunnel is enabled', () => {
    expect(
      validateConnectionForm(
        createForm({
          useSSH: true,
          sshHost: 'bastion',
          sshUsername: 'deploy',
          sshPassword: '',
          sshPrivateKey: '   ',
          sshPrivateKeyPath: ''
        })
      )
    ).toBe('SSH password is required when password authentication is selected')
  })

  it('allows editing an existing SSH key connection without re-entering the private key', () => {
    expect(
      validateConnectionForm(
        createForm({
          useSSH: true,
          sshHost: 'bastion',
          sshUsername: 'deploy',
          sshPassword: '',
          sshPrivateKey: '',
          sshPrivateKeyPath: '/Users/sam/.ssh/id_rsa'
        }),
        { sshAuthMethod: 'privateKey' }
      )
    ).toBeNull()

    expect(
      validateConnectionForm(
        createForm({
          useSSH: true,
          sshHost: 'bastion',
          sshUsername: 'deploy',
          sshPassword: '',
          sshPrivateKey: ''
        }),
        { hasSSHPrivateKey: true, sshAuthMethod: 'privateKey' }
      )
    ).toBeNull()
  })

  it('shows only the saved SSH authentication method when editing', () => {
    expect(getInitialSSHAuthMethod()).toBe('password')
    expect(
      getInitialSSHAuthMethod({
        id: 'conn-2',
        engine: 'mysql',
        name: 'Primary',
        host: '127.0.0.1',
        port: 3306,
        username: 'root',
        useSSH: true,
        createdAt: 1,
        updatedAt: 2,
        hasPassword: false,
        hasSSHPassword: false,
        hasSSHPrivateKey: true
      })
    ).toBe('privateKey')
  })

  it('clears credentials belonging to the unselected SSH authentication method', () => {
    const passwordPayload = buildPayload(
      createForm({
        useSSH: true,
        sshPassword: 'secret',
        sshPrivateKey: 'PRIVATE KEY',
        sshPrivateKeyPath: '/tmp/id_rsa',
        sshPassphrase: 'phrase'
      }),
      'password'
    )
    expect(passwordPayload.sshPassword).toBe('secret')
    expect(passwordPayload.sshPrivateKey).toBe('')
    expect(passwordPayload.sshPrivateKeyPath).toBe('')
    expect(passwordPayload.sshPassphrase).toBe('')

    const privateKeyPayload = buildPayload(
      createForm({
        useSSH: true,
        sshPassword: 'secret',
        sshPrivateKey: ' PRIVATE KEY ',
        sshPrivateKeyPath: ' /tmp/id_rsa ',
        sshPassphrase: 'phrase'
      }),
      'privateKey'
    )
    expect(privateKeyPayload.sshPassword).toBe('')
    expect(privateKeyPayload.sshPrivateKey).toBe('PRIVATE KEY')
    expect(privateKeyPayload.sshPrivateKeyPath).toBe('/tmp/id_rsa')
    expect(privateKeyPayload.sshPassphrase).toBe('phrase')
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
