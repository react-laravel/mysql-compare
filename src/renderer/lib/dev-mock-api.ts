/**
 * Dev-only, in-browser mock of {@link AppAPI}.
 *
 * `npm run dev:ui` serves the renderer in a plain browser where the Tauri IPC
 * bridge does not exist. Without this module `bootstrapApi()` throws *before*
 * `createRoot().render()` runs (`main.tsx`), so the page stays blank and no UI
 * change can be verified outside a full `tauri dev` build.
 *
 * Every method returns the same `IPCResult<T>` envelope the real bridge does,
 * so no component needs a branch. Fixtures live in `dev-mock-fixtures.ts` and
 * the pure response builders in `dev-mock-builders.ts`; this file holds only
 * the mutable session state and the `AppAPI` surface.
 *
 * Query-string switches, dev only:
 * - `?mock=slow`  — inflate every latency so loading / streaming states are
 *   actually observable (skeletons, spinners, progress bars).
 * - `?mock=error` — fail every call except `connection.list`, so the region
 *   error states of every screen can be reached without editing code.
 */
import type { AppAPI, AppRuntimeInfo } from '../../shared/app-api'
import type {
  DbEngine,
  IPCResult,
  SafeConnection,
  SqlDbEngine,
  SSHFileEntry,
  SSHTerminalDataEvent,
  SSHTerminalExitEvent,
  SyncProgressEvent,
  TableDiff
} from '../../shared/types'
import {
  buildDatabaseDiff,
  buildSyncPlan,
  databaseInfo,
  dataDiffFor,
  executeStatements,
  explainResult,
  queryRowsResult,
  tableDiffFor,
  tableSchema,
  terminalBanner,
  terminalCommandOutput,
  terminalPrompt
} from './dev-mock-builders'
import {
  hex,
  initialConnections,
  initialDatabases,
  joinPath,
  NOW,
  parentOf,
  REDIS_TOTAL_KEYS,
  SHOP_TABLES,
  seedToEntry,
  SSH_FILE_CONTENTS,
  sshSeedEntries,
  tableDef
} from './dev-mock-fixtures'

// ---------------------------------------------------------------- mock mode

export type MockMode = 'normal' | 'slow' | 'error'

const MOCK_ERROR_MESSAGE =
  "ER_ACCESS_DENIED_ERROR: Access denied for user 'app'@'10.0.0.12' (mock=error)"

export function readMockMode(): MockMode {
  if (typeof window === 'undefined') return 'normal'
  const value = new URLSearchParams(window.location.search).get('mock')
  if (value === 'error' || value === 'slow') return value
  return 'normal'
}

/** Base latency in ms; multiplied by a per-call weight. */
const BASE_LATENCY: Record<MockMode, number> = { normal: 70, slow: 850, error: 220 }

// ------------------------------------------------------------------ the mock

export function createMockApi(mode: MockMode = readMockMode()): AppAPI {
  const latency = BASE_LATENCY[mode]

  const state = {
    connections: initialConnections(),
    databases: initialDatabases(),
    ssh: new Map<string, SSHFileEntry[]>(),
    terminalSessions: new Map<string, { connectionId: string; line: string }>(),
    terminalSeq: 0
  }

  const terminalDataSubscribers = new Set<(event: SSHTerminalDataEvent) => void>()
  const terminalExitSubscribers = new Set<(event: SSHTerminalExitEvent) => void>()
  const syncProgressSubscribers = new Set<(event: SyncProgressEvent) => void>()

  const pause = (weight = 1): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, Math.round(latency * weight)))

  /** Standard success envelope, with the `?mock=error` override applied. */
  async function respond<T>(data: T, weight = 1): Promise<IPCResult<T>> {
    await pause(weight)
    if (mode === 'error') return { ok: false, error: MOCK_ERROR_MESSAGE }
    return { ok: true, data }
  }

  /** Success envelope that ignores `?mock=error` — used for the connection list
   *  so the sidebar still has something to click in error mode. */
  async function respondAlways<T>(data: T, weight = 1): Promise<IPCResult<T>> {
    await pause(weight)
    return { ok: true, data }
  }

  async function refuse<T>(): Promise<IPCResult<T>> {
    await pause()
    return { ok: false, error: MOCK_ERROR_MESSAGE }
  }

  const failing = (): boolean => mode === 'error'

  // -- lookup helpers ------------------------------------------------------

  function engineOf(connectionId: string): DbEngine {
    return state.connections.find((c) => c.id === connectionId)?.engine ?? 'mysql'
  }

  function sqlEngineOf(connectionId: string): SqlDbEngine {
    const engine = engineOf(connectionId)
    return engine === 'postgres' ? 'postgres' : 'mysql'
  }

  function databasesOf(connectionId: string): Record<string, string[]> {
    let entry = state.databases[connectionId]
    if (!entry) {
      entry = { mock: ['users'] }
      state.databases[connectionId] = entry
    }
    return entry
  }

  function tablesOf(connectionId: string, database: string): string[] {
    const dbs = databasesOf(connectionId)
    let tables = dbs[database]
    if (!tables) {
      tables = [...SHOP_TABLES]
      dbs[database] = tables
    }
    return tables
  }

  // -- sync ----------------------------------------------------------------

  function emitSyncProgress(event: SyncProgressEvent): void {
    for (const cb of syncProgressSubscribers) cb(event)
  }

  async function runSyncProgress(tables: string[]): Promise<{ executed: number; errors: number }> {
    const total = Math.max(1, tables.length)
    let executed = 0
    let errors = 0
    for (let i = 0; i < tables.length; i += 1) {
      const table = tables[i] ?? 'unknown'
      emitSyncProgress({ table, step: 'structure', done: i, total, level: 'info', message: `Creating ${table}` })
      await pause(1.4)
      const failsHere = mode === 'error' && i === Math.floor(tables.length / 2)
      if (failsHere) {
        errors += 1
        emitSyncProgress({
          table,
          step: 'data',
          done: i + 1,
          total,
          level: 'error',
          message: `Failed to copy ${table}: ${MOCK_ERROR_MESSAGE}`
        })
        continue
      }
      emitSyncProgress({
        table,
        step: 'data',
        done: i + 1,
        total,
        level: i % 4 === 3 ? 'warn' : 'info',
        message:
          i % 4 === 3
            ? `${table}: 3 rows skipped (duplicate key)`
            : `${table}: ${tableDef(table).rowCount} rows copied`
      })
      executed += 1
      await pause(0.6)
    }
    emitSyncProgress({
      table: '',
      step: 'done',
      done: total,
      total,
      level: errors > 0 ? 'error' : 'info',
      message: errors > 0 ? `${errors} table(s) failed` : 'Sync finished'
    })
    return { executed, errors }
  }

  // -- SSH filesystem ------------------------------------------------------

  function sshEntries(path: string): SSHFileEntry[] {
    const existing = state.ssh.get(path)
    if (existing) return existing
    const entries = sshSeedEntries(path)
    state.ssh.set(path, entries)
    return entries
  }

  function addSSHEntry(dir: string, entry: SSHFileEntry): void {
    const entries = sshEntries(dir).filter((e) => e.name !== entry.name)
    entries.push(entry)
    entries.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (b.type === 'directory' && a.type !== 'directory') return 1
      return a.name.localeCompare(b.name)
    })
    state.ssh.set(dir, entries)
  }

  function removeSSHEntry(path: string): void {
    const dir = parentOf(path)
    if (!dir) return
    state.ssh.set(dir, sshEntries(dir).filter((entry) => entry.path !== path))
  }

  // -- terminal ------------------------------------------------------------

  function emitTerminalData(sessionId: string, data: string): void {
    for (const cb of terminalDataSubscribers) cb({ sessionId, data })
  }

  // -- the object ----------------------------------------------------------

  const runtime: AppRuntimeInfo = {
    mode: 'web',
    supportsNativeFilePicker: false,
    supportsDirectoryUpload: false,
    supportsTerminalStreaming: true,
    supportsDownload: false
  }

  const mock: AppAPI = {
    runtime,

    connection: {
      // Always succeeds so `?mock=error` still has a navigable tree.
      list: () => respondAlways([...state.connections]),
      upsert: async (conn) => {
        if (failing()) return refuse()
        const previous = state.connections.find((c) => c.id === conn.id)
        const safe: SafeConnection = {
          id: conn.id || `mock-${Date.now()}`,
          engine: conn.engine,
          name: conn.name,
          group: conn.group,
          host: conn.host,
          port: conn.port,
          username: conn.username,
          database: conn.database,
          useSSH: conn.useSSH,
          sshHost: conn.sshHost,
          sshPort: conn.sshPort,
          sshUsername: conn.sshUsername,
          sshPrivateKeyPath: conn.sshPrivateKeyPath,
          createdAt: conn.createdAt || Date.now(),
          updatedAt: Date.now(),
          // The real store never echoes secrets back; it only reports whether
          // one is on file, keeping any previously saved value.
          hasPassword: Boolean(conn.password) || previous?.hasPassword === true,
          hasSSHPassword: Boolean(conn.sshPassword) || previous?.hasSSHPassword === true,
          hasSSHPrivateKey:
            Boolean(conn.sshPrivateKey || conn.sshPrivateKeyPath) || previous?.hasSSHPrivateKey === true,
          databaseCredentials: previous?.databaseCredentials ?? {}
        }
        const index = state.connections.findIndex((c) => c.id === safe.id)
        if (index >= 0) state.connections[index] = safe
        else state.connections.push(safe)
        return respond(safe)
      },
      remove: async (id) => {
        if (failing()) return refuse()
        state.connections = state.connections.filter((c) => c.id !== id)
        return respond(undefined)
      },
      close: () => respond(undefined),
      setDatabaseCredential: async (id, database, credential) => {
        if (failing()) return refuse()
        const conn = state.connections.find((c) => c.id === id)
        if (!conn) return { ok: false, error: `Unknown connection ${id}` }
        const next: SafeConnection = {
          ...conn,
          databaseCredentials: {
            ...conn.databaseCredentials,
            [database]: { username: credential.username, hasPassword: Boolean(credential.password) }
          }
        }
        state.connections = state.connections.map((c) => (c.id === id ? next : c))
        return respond(next)
      },
      testDatabaseCredential: (_id, database) =>
        respond({ message: `Connected to ${database} (mock)` }, 2),
      test: (conn) => respond({ message: `${conn.host}:${conn.port} reachable (mock)` }, 2)
    },

    db: {
      listDatabases: (connectionId) => respond(Object.keys(databasesOf(connectionId))),
      getDatabaseInfo: (connectionId, database) =>
        respond(
          databaseInfo({
            engine: engineOf(connectionId),
            database,
            tables: tablesOf(connectionId, database),
            redisKeyCount: REDIS_TOTAL_KEYS[database]
          }),
          1.5
        ),
      listTables: (connectionId, database) => respond([...tablesOf(connectionId, database)]),
      queryRows: (req) => respond(queryRowsResult(engineOf(req.connectionId), req), 1.5),
      insertRow: () => (failing() ? refuse() : respond(undefined)),
      updateRow: () => (failing() ? refuse() : respond(undefined)),
      deleteRows: () => (failing() ? refuse() : respond(undefined)),
      executeSQL: async (_connectionId, sql) => {
        if (failing()) return refuse()
        await pause(2)
        return { ok: true, data: executeStatements(sql) }
      },
      explainSQL: (req) => respond(explainResult(sqlEngineOf(req.connectionId), req.sql), 1.5),
      renameTable: async (req) => {
        if (failing()) return refuse()
        const tables = tablesOf(req.connectionId, req.database)
        const index = tables.indexOf(req.table)
        if (index >= 0) tables[index] = req.newTable
        return respond({ table: req.newTable })
      },
      copyTable: async (req) => {
        if (failing()) return refuse()
        const tables = tablesOf(req.connectionId, req.database)
        if (!tables.includes(req.targetTable)) tables.push(req.targetTable)
        return respond({ table: req.targetTable })
      },
      dropDatabase: async (req) => {
        if (failing()) return refuse()
        delete databasesOf(req.connectionId)[req.database]
        return respond(undefined)
      },
      dropTable: async (req) => {
        if (failing()) return refuse()
        const dbs = databasesOf(req.connectionId)
        dbs[req.database] = tablesOf(req.connectionId, req.database).filter((t) => t !== req.table)
        return respond(undefined)
      },
      truncateTable: () => (failing() ? refuse() : respond(undefined)),
      exportTable: (req) =>
        respond(
          {
            canceled: false,
            filePath: `/Users/you/Downloads/${req.database}.${req.table}.${req.format}`,
            rowsExported: tableDef(req.table).rowCount
          },
          3
        ),
      exportDatabase: (req) => {
        const tables = tablesOf(req.connectionId, req.database)
        return respond(
          {
            canceled: false,
            filePath: `/Users/you/Downloads/${req.database}.sql`,
            tablesExported: tables.length,
            rowsExported: tables.reduce((sum, table) => sum + tableDef(table).rowCount, 0),
            backend: req.backend ?? 'builtin',
            rowsCountAccurate: true
          },
          6
        )
      },
      importTable: (req) =>
        respond(
          {
            canceled: false,
            filePath: req.fileName ? `/Users/you/Downloads/${req.fileName}` : undefined,
            rowsImported: 128,
            statementsExecuted: 4
          },
          3
        )
    },

    schema: {
      getTable: (connectionId, _database, table) =>
        respond(tableSchema(sqlEngineOf(connectionId), table), 1.2)
    },

    ssh: {
      listFiles: (req) => {
        const path = req.path && req.path.length > 0 ? req.path : '/home/deploy'
        return respond({ path, parentPath: parentOf(path), entries: [...sshEntries(path)] }, 1.5)
      },
      uploadFile: async (req) => {
        if (failing()) return refuse()
        const name = `upload-${hex(Date.now(), 6)}.txt`
        addSSHEntry(req.remoteDir, seedToEntry(req.remoteDir, { name, type: 'file', size: 2048, days: 0 }))
        return respond({ canceled: false, remotePath: joinPath(req.remoteDir, name) }, 2)
      },
      uploadDirectory: async (req) => {
        if (failing()) return refuse()
        const name = `uploaded-${hex(Date.now(), 4)}`
        addSSHEntry(req.remoteDir, seedToEntry(req.remoteDir, { name, type: 'directory', days: 0 }))
        return respond({ canceled: false, remotePath: joinPath(req.remoteDir, name) }, 3)
      },
      uploadEntries: async (req) => {
        if (failing()) return refuse()
        for (const entry of req.entries) {
          const target = joinPath(req.remoteDir, entry.relativePath)
          const dir = parentOf(target) ?? req.remoteDir
          const name = target.slice(target.lastIndexOf('/') + 1)
          addSSHEntry(
            dir,
            seedToEntry(dir, {
              name,
              type: entry.type === 'directory' ? 'directory' : 'file',
              size: entry.type === 'file' ? 4096 : undefined,
              days: 0
            })
          )
        }
        return respond({ canceled: false, remotePath: req.remoteDir }, 2.5)
      },
      downloadFile: (req) =>
        respond(
          {
            canceled: false,
            remotePath: req.remotePath,
            localPath: `/Users/you/Downloads/${req.remotePath.slice(req.remotePath.lastIndexOf('/') + 1)}`
          },
          3
        ),
      downloadDirectory: (req) =>
        respond(
          {
            canceled: false,
            remotePath: req.remotePath,
            localPath: `/Users/you/Downloads/${req.remotePath.slice(req.remotePath.lastIndexOf('/') + 1)}`
          },
          4
        ),
      readFile: (req) =>
        respond(
          {
            path: req.remotePath,
            content:
              SSH_FILE_CONTENTS[req.remotePath] ??
              `# ${req.remotePath}\n\nMock contents served by dev-mock-api.ts.\nEdit and save to exercise the write path.\n`
          },
          1.5
        ),
      writeFile: async (req) => {
        if (failing()) return refuse()
        SSH_FILE_CONTENTS[req.remotePath] = req.content
        return respond({ canceled: false, remotePath: req.remotePath }, 1.5)
      },
      createDirectory: async (req) => {
        if (failing()) return refuse()
        addSSHEntry(req.remoteDir, seedToEntry(req.remoteDir, { name: req.name, type: 'directory', days: 0 }))
        return respond({ canceled: false, remotePath: joinPath(req.remoteDir, req.name) })
      },
      deleteFile: async (req) => {
        if (failing()) return refuse()
        removeSSHEntry(req.remotePath)
        return respond({ canceled: false, remotePath: req.remotePath })
      },
      moveFile: async (req) => {
        if (failing()) return refuse()
        const dir = parentOf(req.remotePath)
        const existing = dir ? sshEntries(dir).find((e) => e.path === req.remotePath) : undefined
        removeSSHEntry(req.remotePath)
        const nextDir = parentOf(req.nextPath) ?? '/'
        const name = req.nextPath.slice(req.nextPath.lastIndexOf('/') + 1)
        addSSHEntry(nextDir, {
          name,
          path: req.nextPath,
          type: existing?.type ?? 'file',
          size: existing?.size ?? 0,
          modifiedAt: NOW,
          permissions: existing?.permissions ?? '-rw-r--r--'
        })
        return respond({ canceled: false, remotePath: req.nextPath }, 1.5)
      },
      createTerminal: async (req) => {
        if (failing()) return refuse()
        state.terminalSeq += 1
        const sessionId = `mock-term-${state.terminalSeq}`
        state.terminalSessions.set(sessionId, { connectionId: req.connectionId, line: '' })
        const name = state.connections.find((c) => c.id === req.connectionId)?.name ?? 'mock host'
        const result = await respond({ sessionId }, 2)
        // Scheduled *after* the envelope resolves: callers only learn the
        // session id from this promise, and they drop events for other ids.
        setTimeout(() => {
          emitTerminalData(sessionId, `${terminalBanner(name)}\r\n${terminalPrompt()}`)
        }, Math.round(latency))
        return result
      },
      writeTerminal: async (req) => {
        const session = state.terminalSessions.get(req.sessionId)
        if (!session) return { ok: false, error: `Unknown terminal session ${req.sessionId}` }
        for (const char of req.data) {
          if (char === '\r' || char === '\n') {
            const output = terminalCommandOutput(session.line.trim())
            session.line = ''
            emitTerminalData(req.sessionId, `\r\n${output ? `${output}\r\n` : ''}${terminalPrompt()}`)
          } else if (char === '\u007f') {
            if (session.line.length > 0) {
              session.line = session.line.slice(0, -1)
              emitTerminalData(req.sessionId, '\b \b')
            }
          } else {
            session.line += char
            emitTerminalData(req.sessionId, char)
          }
        }
        return { ok: true }
      },
      resizeTerminal: async () => ({ ok: true }),
      closeTerminal: async (req) => {
        state.terminalSessions.delete(req.sessionId)
        for (const cb of terminalExitSubscribers) {
          cb({ sessionId: req.sessionId, message: 'session closed' })
        }
        return { ok: true }
      },
      onTerminalData: (cb) => {
        terminalDataSubscribers.add(cb)
        return () => {
          terminalDataSubscribers.delete(cb)
        }
      },
      onTerminalExit: (cb) => {
        terminalExitSubscribers.add(cb)
        return () => {
          terminalExitSubscribers.delete(cb)
        }
      }
    },

    system: {
      // A browser File has no filesystem path; the name is the closest truth.
      getPathForFile: (file) => file.name
    },

    diff: {
      databases: (req) =>
        respond(
          buildDatabaseDiff({
            sourceDatabase: req.sourceDatabase,
            sourceTables: tablesOf(req.sourceConnectionId, req.sourceDatabase),
            targetDatabase: req.targetDatabase,
            targetTables: tablesOf(req.targetConnectionId, req.targetDatabase),
            includeData: req.includeData ?? false,
            only: req.tables
          }),
          6
        ),
      table: (req) => {
        const inSource = tablesOf(req.sourceConnectionId, req.sourceDatabase).includes(req.table)
        const inTarget = tablesOf(req.targetConnectionId, req.targetDatabase).includes(req.table)
        const kind: TableDiff['kind'] = !inTarget
          ? 'only-in-source'
          : !inSource
            ? 'only-in-target'
            : 'modified'
        const includeData = req.includeData ?? true
        return respond(
          {
            tableDiff: tableDiffFor(req.table, kind, includeData),
            rowComparison: includeData ? { table: req.table, dataDiff: dataDiffFor(req.table) } : null
          },
          3
        )
      }
    },

    sync: {
      buildPlan: (req) => respond(buildSyncPlan(req.tables, req.syncStructure, req.syncData), 3),
      execute: async (req) => {
        const result = await runSyncProgress(req.tables)
        if (mode === 'error' && result.errors === 0) return refuse()
        return { ok: true, data: result }
      },
      onProgress: (cb) => {
        syncProgressSubscribers.add(cb)
        return () => {
          syncProgressSubscribers.delete(cb)
        }
      }
    }
  }

  return mock
}
