import { randomUUID } from 'node:crypto'
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import type {
  ConnectionConfig,
  SSHTerminalCloseRequest,
  SSHTerminalCreateRequest,
  SSHTerminalCreateResult,
  SSHTerminalDataEvent,
  SSHTerminalExitEvent,
  SSHTerminalResizeRequest,
  SSHTerminalWriteRequest
} from '../../shared/types'
import { connectionStore } from '../store/connection-store'
import { createSSHHostVerifier } from './ssh-host-verifier'

const DEFAULT_TERMINAL_COLS = 100
const DEFAULT_TERMINAL_ROWS = 30

interface TerminalSession {
  client: Client
  channel: ClientChannel
  closed: boolean
  ownerId: string
}

interface TerminalSessionEvents {
  onData: (event: SSHTerminalDataEvent) => void
  onExit: (event: SSHTerminalExitEvent) => void
}

class SSHTerminalService {
  private readonly sessions = new Map<string, TerminalSession>()

  async createSession(
    req: SSHTerminalCreateRequest,
    events: TerminalSessionEvents,
    ownerId = 'local'
  ): Promise<SSHTerminalCreateResult> {
    const conn = this.getSSHConnection(req.connectionId)
    const client = await connectSSH(buildSSHConfig(conn))

    try {
      const channel = await openShell(client, {
        cols: clampTerminalSize(req.cols, DEFAULT_TERMINAL_COLS),
        rows: clampTerminalSize(req.rows, DEFAULT_TERMINAL_ROWS)
      })
      const sessionId = randomUUID()
      const session: TerminalSession = { client, channel, closed: false, ownerId }

      this.sessions.set(sessionId, session)
      channel.on('data', (chunk: Buffer | string) => {
        events.onData({ sessionId, data: chunk.toString() })
      })
      channel.stderr.on('data', (chunk: Buffer | string) => {
        events.onData({ sessionId, data: chunk.toString() })
      })
      channel.once('close', () => {
        this.cleanupSession(sessionId)
        events.onExit({ sessionId })
      })
      client.once('error', (error) => {
        this.cleanupSession(sessionId)
        events.onExit({ sessionId, message: error.message })
      })
      client.once('close', () => {
        this.cleanupSession(sessionId)
        events.onExit({ sessionId })
      })

      return { sessionId }
    } catch (error) {
      try {
        client.end()
      } catch {
        // noop
      }
      throw error
    }
  }

  write(req: SSHTerminalWriteRequest, ownerId = 'local'): void {
    const session = this.getSession(req.sessionId, ownerId)
    session.channel.write(req.data)
  }

  resize(req: SSHTerminalResizeRequest, ownerId = 'local'): void {
    const session = this.getSession(req.sessionId, ownerId)
    const cols = clampTerminalSize(req.cols, DEFAULT_TERMINAL_COLS)
    const rows = clampTerminalSize(req.rows, DEFAULT_TERMINAL_ROWS)
    session.channel.setWindow(rows, cols, rows * 16, cols * 8)
  }

  close(req: SSHTerminalCloseRequest, ownerId = 'local'): void {
    this.getSession(req.sessionId, ownerId)
    this.cleanupSession(req.sessionId)
  }

  closeAll(): void {
    for (const sessionId of Array.from(this.sessions.keys())) {
      this.cleanupSession(sessionId)
    }
  }

  private getSession(sessionId: string, ownerId: string): TerminalSession {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed) throw new Error(`SSH terminal session ${sessionId} not found`)
    if (session.ownerId !== ownerId) throw new Error('SSH terminal session is not owned by this client')
    return session
  }

  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed) return

    session.closed = true
    this.sessions.delete(sessionId)
    try {
      session.channel.close()
    } catch {
      // noop
    }
    try {
      session.client.end()
    } catch {
      // noop
    }
  }

  private getSSHConnection(connectionId: string): ConnectionConfig {
    const conn = connectionStore.getFull(connectionId)
    if (!conn) throw new Error(`Connection ${connectionId} not found`)
    if (!conn.useSSH) throw new Error('This connection does not use SSH')
    if (!conn.sshHost || !conn.sshUsername) throw new Error('SSH host and username are required')
    return conn
  }
}

function buildSSHConfig(conn: ConnectionConfig): ConnectConfig {
  const config: ConnectConfig = {
    host: conn.sshHost,
    port: conn.sshPort || 22,
    username: conn.sshUsername,
    readyTimeout: 15000,
    keepaliveInterval: 30000,
    hostVerifier: createSSHHostVerifier(conn)
  }

  if (conn.sshPrivateKey) {
    config.privateKey = conn.sshPrivateKey
    if (conn.sshPassphrase) config.passphrase = conn.sshPassphrase
  } else if (conn.sshPassword) {
    config.password = conn.sshPassword
  } else {
    throw new Error('SSH requires either privateKey or password')
  }

  return config
}

function connectSSH(config: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    client.once('ready', () => resolve(client))
    client.once('error', reject)
    client.connect(config)
  })
}

function openShell(client: Client, size: { cols: number; rows: number }): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.shell(
      {
        term: 'xterm-256color',
        cols: size.cols,
        rows: size.rows,
        width: size.cols * 8,
        height: size.rows * 16
      },
      (error, channel) => {
        if (error) {
          reject(error)
          return
        }
        resolve(channel)
      }
    )
  })
}

function clampTerminalSize(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(2, Math.min(500, Math.floor(value as number)))
}

export const sshTerminalService = new SSHTerminalService()
