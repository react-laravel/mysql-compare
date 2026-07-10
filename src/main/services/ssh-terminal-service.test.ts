import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionConfig } from '../../shared/types'

type Listener = (...args: unknown[]) => void

interface MockEmitter {
  on: (event: string, listener: Listener) => MockEmitter
  once: (event: string, listener: Listener) => MockEmitter
  emit: (event: string, ...args: unknown[]) => void
}

interface MockChannel extends MockEmitter {
  stderr: MockEmitter
  write: ReturnType<typeof vi.fn>
  setWindow: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

interface MockClient extends MockEmitter {
  channel: MockChannel
  connectConfig?: unknown
  shellOptions?: unknown
  connect: ReturnType<typeof vi.fn>
  shell: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

const { clients, getFull, Client } = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void

  function createEmitter() {
    const listeners = new Map<string, Listener[]>()
    return {
      on(event: string, listener: Listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener])
        return this
      },
      once(event: string, listener: Listener) {
        const wrapped: Listener = (...args) => {
          listeners.set(event, (listeners.get(event) ?? []).filter((item) => item !== wrapped))
          listener(...args)
        }
        listeners.set(event, [...(listeners.get(event) ?? []), wrapped])
        return this
      },
      emit(event: string, ...args: unknown[]) {
        for (const listener of listeners.get(event) ?? []) listener(...args)
      }
    }
  }

  function createChannel() {
    const emitter = createEmitter()
    const channel = {
      ...emitter,
      stderr: createEmitter(),
      write: vi.fn(),
      setWindow: vi.fn(),
      close: vi.fn(() => channel.emit('close'))
    }
    return channel
  }

  const clients: MockClient[] = []
  const getFull = vi.fn()

  class Client {
    constructor() {
      const emitter = createEmitter()
      const channel = createChannel()
      const client = {
        ...emitter,
        channel,
        connectConfig: undefined as unknown,
        shellOptions: undefined as unknown,
        connect: vi.fn((config: unknown) => {
          client.connectConfig = config
          emitter.emit('ready')
        }),
        shell: vi.fn((options: unknown, cb: (error: Error | undefined, shellChannel: typeof channel) => void) => {
          client.shellOptions = options
          cb(undefined, channel)
        }),
        end: vi.fn(() => emitter.emit('close'))
      }
      clients.push(client)
      return client
    }
  }

  return { clients, getFull, Client }
})

vi.mock('ssh2', () => ({
  Client
}))

vi.mock('../store/connection-store', () => ({
  connectionStore: {
    getFull
  }
}))

import { sshTerminalService } from './ssh-terminal-service'

describe('SSHTerminalService', () => {
  beforeEach(() => {
    clients.length = 0
    getFull.mockReset()
  })

  it('creates an interactive SSH shell session and forwards terminal data', async () => {
    const onData = vi.fn()
    const onExit = vi.fn()
    getFull.mockReturnValue(buildConnection())

    const result = await sshTerminalService.createSession(
      { connectionId: 'conn-1', cols: 120, rows: 40 },
      { onData, onExit }
    )

    const client = clients[0]!
    expect(client.connectConfig).toEqual(expect.objectContaining({
      host: 'ssh.internal',
      port: 2222,
      username: 'deployer',
      password: 'ssh-secret'
    }))
    expect(client.shellOptions).toEqual(expect.objectContaining({ term: 'xterm-256color', cols: 120, rows: 40 }))

    client.channel.emit('data', Buffer.from('hello'))
    client.channel.stderr.emit('data', Buffer.from('error'))

    expect(onData).toHaveBeenCalledWith({ sessionId: result.sessionId, data: 'hello' })
    expect(onData).toHaveBeenCalledWith({ sessionId: result.sessionId, data: 'error' })
    expect(onExit).not.toHaveBeenCalled()
  })

  it('writes input, resizes the pty, and closes the session', async () => {
    getFull.mockReturnValue(buildConnection())

    const result = await sshTerminalService.createSession(
      { connectionId: 'conn-1', cols: 80, rows: 24 },
      { onData: vi.fn(), onExit: vi.fn() }
    )
    const client = clients[0]!

    sshTerminalService.write({ sessionId: result.sessionId, data: 'ls\r' })
    sshTerminalService.resize({ sessionId: result.sessionId, cols: 100, rows: 32 })
    sshTerminalService.close({ sessionId: result.sessionId })

    expect(client.channel.write).toHaveBeenCalledWith('ls\r')
    expect(client.channel.setWindow).toHaveBeenCalledWith(32, 100, 512, 800)
    expect(client.channel.close).toHaveBeenCalled()
    expect(client.end).toHaveBeenCalled()
  })

  it('rejects terminal control from a different client owner', async () => {
    getFull.mockReturnValue(buildConnection())
    const result = await sshTerminalService.createSession(
      { connectionId: 'conn-1', cols: 80, rows: 24 },
      { onData: vi.fn(), onExit: vi.fn() },
      'web-client-a'
    )

    expect(() => sshTerminalService.write(
      { sessionId: result.sessionId, data: 'whoami\r' },
      'web-client-b'
    )).toThrow('not owned by this client')
    expect(clients[0]?.channel.write).not.toHaveBeenCalled()

    sshTerminalService.close({ sessionId: result.sessionId }, 'web-client-a')
  })
})

function buildConnection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1',
    engine: 'mysql',
    name: 'Primary',
    host: 'db.internal',
    port: 3306,
    username: 'root',
    useSSH: true,
    sshHost: 'ssh.internal',
    sshPort: 2222,
    sshUsername: 'deployer',
    sshPassword: 'ssh-secret',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}
