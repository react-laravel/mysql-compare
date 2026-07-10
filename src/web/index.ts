import express, { type Request, type Response } from 'express'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectionStore } from '../main/store/connection-store'
import { dbService } from '../main/services/db-service'
import { diffService } from '../main/services/diff-service'
import { exportService } from '../main/services/export-service'
import { importService } from '../main/services/import-service'
import { schemaService } from '../main/services/schema-service'
import { resolveQueryRowsRequest } from '../main/services/drivers/query-order-utils'
import { sshFileService } from '../main/services/ssh-file-service'
import { sshService } from '../main/services/ssh-service'
import { sshTerminalService } from '../main/services/ssh-terminal-service'
import { syncService } from '../main/services/sync-service'
import {
  establishWebSession,
  getRequestSessionId,
  loadWebSecurityConfig,
  requireBasicAuth,
  requireMutationProtection,
  securityHeaders
} from './security'
import type {
  ConnectionConfig,
  CopyTableRequest,
  DatabaseInfo,
  DeleteRowsRequest,
  DiffRequest,
  DropDatabaseRequest,
  DropTableRequest,
  ExplainSQLRequest,
  ExportDatabaseRequest,
  ExportTableRequest,
  ImportTableRequest,
  InsertRowRequest,
  IPCResult,
  QueryRowsRequest,
  QueryRowsResult,
  RenameTableRequest,
  SSHCreateDirectoryRequest,
  SSHDeleteFileRequest,
  SSHDownloadFileRequest,
  SSHListFilesRequest,
  SSHMoveFileRequest,
  SSHReadFileRequest,
  SSHTerminalCloseRequest,
  SSHTerminalCreateRequest,
  SSHTerminalDataEvent,
  SSHTerminalExitEvent,
  SSHTerminalResizeRequest,
  SSHTerminalWriteRequest,
  SSHWriteFileRequest,
  SyncProgressEvent,
  SyncRequest,
  TableDiffRequest,
  TruncateTableRequest,
  UpdateRowRequest
} from '../shared/types'

interface BrowserUploadFile {
  relativePath: string
  contentBase64: string
}

const API_PREFIX = '/api'
const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const STATIC_DIST_DIR = resolve(PROJECT_ROOT, 'dist-web')
const STATIC_INDEX_FILE = join(STATIC_DIST_DIR, 'index.html')
const webSecurity = loadWebSecurityConfig()
const PORT = webSecurity.port
const HOST = webSecurity.host
const JSON_LIMIT = process.env['MYSQL_COMPARE_JSON_LIMIT'] || '25mb'

const syncClients = new Map<string, Set<Response>>()
const terminalDataClients = new Map<string, Set<Response>>()
const terminalExitClients = new Map<string, Set<Response>>()

const app = express()
app.disable('x-powered-by')
app.use(securityHeaders())

const heartbeat = setInterval(() => {
  broadcastAllSSE(syncClients, null)
  broadcastAllSSE(terminalDataClients, null)
  broadcastAllSSE(terminalExitClients, null)
}, 15000)

app.get(`${API_PREFIX}/health`, (_req, res) => {
  sendOK(res, {
    status: 'ok',
    mode: 'web',
    timestamp: new Date().toISOString()
  })
})

app.use(requireBasicAuth(webSecurity))
app.use(establishWebSession(webSecurity))
app.use(API_PREFIX, requireMutationProtection(webSecurity))
app.use(API_PREFIX, express.json({ limit: JSON_LIMIT }))

app.get(`${API_PREFIX}/session`, asyncHandler(async () => ({ authenticated: true })))

app.get(`${API_PREFIX}/connections`, asyncHandler(async () => connectionStore.list()))

app.post(`${API_PREFIX}/connections`, asyncHandler(async (req) => {
  const payload = req.body as ConnectionConfig
  const saved = connectionStore.upsert(payload)
  await dbService.closeConnection(saved.id)
  return saved
}))

app.delete(`${API_PREFIX}/connections/:id`, asyncHandler(async (req) => {
  const connectionId = getParam(req, 'id')
  connectionStore.remove(connectionId)
  await dbService.closeConnection(connectionId)
  return undefined
}))

app.post(`${API_PREFIX}/connections/:id/close`, asyncHandler(async (req) => {
  await dbService.closeConnection(getParam(req, 'id'))
  return undefined
}))

app.post(`${API_PREFIX}/connections/:id/database-credentials/:database`, asyncHandler(async (req) => {
  const saved = connectionStore.setDatabaseCredential(
    getParam(req, 'id'),
    getParam(req, 'database'),
    req.body
  )
  await dbService.closeConnection(saved.id)
  return saved
}))

app.post(`${API_PREFIX}/connections/:id/database-credentials/:database/test`, asyncHandler(async (req) => {
  const connection = connectionStore.resolveDatabaseCredentialTest(
    getParam(req, 'id'),
    getParam(req, 'database'),
    req.body
  )
  const message = await dbService.testConnection(connection)
  return { message }
}))

app.post(`${API_PREFIX}/connections/test`, asyncHandler(async (req) => {
  const payload = connectionStore.resolveSecrets(req.body as ConnectionConfig)
  const message = await dbService.testConnection(payload)
  return { message }
}))

app.get(`${API_PREFIX}/db/:connectionId/databases`, asyncHandler(async (req) => {
  const driver = await dbService.getDriver(getParam(req, 'connectionId'))
  return driver.listDatabases()
}))

app.get(`${API_PREFIX}/db/:connectionId/databases/:database`, asyncHandler(async (req) => {
  const driver = await dbService.getDriver(getParam(req, 'connectionId'))
  return driver.getDatabaseInfo(getParam(req, 'database')) as Promise<DatabaseInfo>
}))

app.get(`${API_PREFIX}/db/:connectionId/databases/:database/tables`, asyncHandler(async (req) => {
  const driver = await dbService.getDriver(getParam(req, 'connectionId'))
  return driver.listTables(getParam(req, 'database'))
}))

app.post(`${API_PREFIX}/db/query-rows`, asyncHandler(async (req) => {
  const payload = req.body as QueryRowsRequest
  const driver = await dbService.getDriver(payload.connectionId)
  const schema = await schemaService.getTableSchema(payload.connectionId, payload.database, payload.table)
  if (payload.orderBy && !schema.columns.some((column) => column.name === payload.orderBy?.column)) {
    throw new Error(`Unknown sort column "${payload.orderBy.column}"`)
  }

  const { rows, total } = await driver.queryRows(resolveQueryRowsRequest(payload, schema))
  const result: QueryRowsResult = {
    rows,
    total,
    hasPrimaryKey: schema.primaryKey.length > 0,
    primaryKey: schema.primaryKey,
    columns: schema.columns
  }
  return result
}))

app.post(`${API_PREFIX}/db/insert-row`, asyncHandler(async (req) => {
  const payload = req.body as InsertRowRequest
  const driver = await dbService.getDriver(payload.connectionId)
  return driver.insertRow(payload)
}))

app.post(`${API_PREFIX}/db/update-row`, asyncHandler(async (req) => {
  const payload = req.body as UpdateRowRequest
  const driver = await dbService.getDriver(payload.connectionId)
  return driver.updateRow(payload)
}))

app.post(`${API_PREFIX}/db/delete-rows`, asyncHandler(async (req) => {
  const payload = req.body as DeleteRowsRequest
  const driver = await dbService.getDriver(payload.connectionId)
  return driver.deleteRows(payload)
}))

app.post(`${API_PREFIX}/db/execute-sql`, asyncHandler(async (req) => {
  const payload = req.body as { connectionId: string; sql: string; database?: string }
  const driver = await dbService.getDriver(payload.connectionId)
  return driver.executeSQL(payload.sql, payload.database)
}))

app.post(`${API_PREFIX}/db/explain-sql`, asyncHandler(async (req) => {
  const payload = req.body as ExplainSQLRequest
  const driver = await dbService.getDriver(payload.connectionId)
  return driver.explainSQL(payload.sql, payload.database)
}))

app.post(`${API_PREFIX}/db/rename-table`, asyncHandler(async (req) => {
  const payload = req.body as RenameTableRequest
  const driver = await dbService.getDriver(payload.connectionId)
  return driver.renameTable(payload)
}))

app.post(`${API_PREFIX}/db/copy-table`, asyncHandler(async (req) => {
  const payload = req.body as CopyTableRequest
  const driver = await dbService.getDriver(payload.connectionId)
  return driver.copyTable(payload)
}))

app.post(`${API_PREFIX}/db/drop-database`, asyncHandler(async (req) => {
  const payload = req.body as DropDatabaseRequest
  const driver = await dbService.getDriver(payload.connectionId)
  return driver.dropDatabase(payload)
}))

app.post(`${API_PREFIX}/db/drop-table`, asyncHandler(async (req) => {
  const payload = req.body as DropTableRequest
  const driver = await dbService.getDriver(payload.connectionId)
  return driver.dropTable(payload)
}))

app.post(`${API_PREFIX}/db/truncate-table`, asyncHandler(async (req) => {
  const payload = req.body as TruncateTableRequest
  const driver = await dbService.getDriver(payload.connectionId)
  const tableScope = driver.engine === 'postgres' ? 'public' : payload.database
  return driver.executeSQL(driver.dialect.renderTruncate(tableScope, payload.table), payload.database)
}))

app.post(`${API_PREFIX}/db/export-table`, async (req, res) => {
  try {
    const payload = req.body as ExportTableRequest
    const extension = payload.format === 'sql' ? 'sql' : payload.format
    await withTempFile(`table-export-${Date.now()}.${extension}`, async (filePath) => {
      const result = await exportService.exportTable(payload, { filePath })
      if (result.canceled || !result.filePath) {
        sendOK(res, result)
        return
      }

      const fileName = basename(result.filePath)
      const content = await readFile(result.filePath)
      res.setHeader('Content-Type', getExportMimeType(payload.format))
      res.setHeader('Content-Disposition', toAttachmentHeader(fileName))
      res.setHeader('X-Download-Name', encodeURIComponent(fileName))
      res.setHeader('X-Rows-Exported', String(result.rowsExported))
      res.send(content)
    })
  } catch (error) {
    sendError(res, error)
  }
})

app.post(`${API_PREFIX}/db/export-database`, async (req, res) => {
  try {
    const payload = req.body as ExportDatabaseRequest
    await withTempFile(`database-export-${Date.now()}.sql`, async (filePath) => {
      const result = await exportService.exportDatabase(payload, { filePath })
      if (result.canceled || !result.filePath) {
        sendOK(res, result)
        return
      }

      const fileName = basename(result.filePath)
      const content = await readFile(result.filePath)
      res.setHeader('Content-Type', getExportMimeType('sql'))
      res.setHeader('Content-Disposition', toAttachmentHeader(fileName))
      res.setHeader('X-Download-Name', encodeURIComponent(fileName))
      res.setHeader('X-Tables-Exported', String(result.tablesExported))
      res.setHeader('X-Rows-Exported', String(result.rowsExported))
      res.setHeader('X-Export-Backend', result.backend || 'builtin')
      res.setHeader('X-Rows-Count-Accurate', String(result.rowsCountAccurate !== false))
      res.send(content)
    })
  } catch (error) {
    sendError(res, error)
  }
})

app.post(`${API_PREFIX}/db/import-table`, asyncHandler(async (req) => {
  return importService.importTable(req.body as ImportTableRequest)
}))

app.get(`${API_PREFIX}/schema/:connectionId/:database/:table`, asyncHandler(async (req) => {
  return schemaService.getTableSchema(
    getParam(req, 'connectionId'),
    getParam(req, 'database'),
    getParam(req, 'table')
  )
}))

app.post(`${API_PREFIX}/diff/databases`, asyncHandler(async (req) => {
  const payload = req.body as DiffRequest
  return diffService.diffDatabases(
    payload.sourceConnectionId,
    payload.sourceDatabase,
    payload.targetConnectionId,
    payload.targetDatabase,
    payload.includeData ?? true,
    payload.tables
  )
}))

app.post(`${API_PREFIX}/diff/table`, asyncHandler(async (req) => {
  const payload = req.body as TableDiffRequest
  return diffService.diffTable(
    payload.sourceConnectionId,
    payload.sourceDatabase,
    payload.targetConnectionId,
    payload.targetDatabase,
    payload.table,
    payload.includeData ?? true
  )
}))

app.get(`${API_PREFIX}/sync/events/progress`, (req, res) => {
  attachSSEClient(req, res, syncClients, getRequestSessionId(req))
})

app.post(`${API_PREFIX}/sync/build-plan`, asyncHandler(async (req) => {
  return syncService.buildPlan(req.body as SyncRequest)
}))

app.post(`${API_PREFIX}/sync/execute`, asyncHandler(async (req) => {
  const sessionId = getRequestSessionId(req)
  return syncService.execute(req.body as SyncRequest, {
    onProgress: (event: SyncProgressEvent) => broadcastSSE(syncClients, sessionId, event)
  })
}))

app.post(`${API_PREFIX}/ssh/list-files`, asyncHandler(async (req) => {
  return sshFileService.listFiles(req.body as SSHListFilesRequest)
}))

app.post(`${API_PREFIX}/ssh/upload-file`, asyncHandler(async (req) => {
  const payload = req.body as { connectionId: string; remoteDir: string; files?: BrowserUploadFile[] }
  if (!payload.files?.length) return { canceled: true }
  return sshFileService.uploadBrowserFiles({ ...payload, files: payload.files })
}))

app.post(`${API_PREFIX}/ssh/upload-directory`, asyncHandler(async (req) => {
  const payload = req.body as { connectionId: string; remoteDir: string; files?: BrowserUploadFile[] }
  if (!payload.files?.length) return { canceled: true }
  return sshFileService.uploadBrowserFiles({ ...payload, files: payload.files })
}))

app.post(`${API_PREFIX}/ssh/upload-entries`, asyncHandler(async () => {
  throw new Error('Drag-and-drop SSH upload is unavailable in web mode. Use Upload File or Upload Folder instead.')
}))

app.post(`${API_PREFIX}/ssh/download-file`, async (req, res) => {
  try {
    const payload = req.body as SSHDownloadFileRequest
    const result = await sshFileService.downloadFileContent(payload)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', toAttachmentHeader(result.fileName))
    res.setHeader('X-Download-Name', encodeURIComponent(result.fileName))
    res.send(result.content)
  } catch (error) {
    sendError(res, error)
  }
})

app.post(`${API_PREFIX}/ssh/download-directory`, asyncHandler(async () => {
  throw new Error('Directory download is not yet supported in web mode.')
}))

app.post(`${API_PREFIX}/ssh/read-file`, asyncHandler(async (req) => {
  return sshFileService.readFile(req.body as SSHReadFileRequest)
}))

app.post(`${API_PREFIX}/ssh/write-file`, asyncHandler(async (req) => {
  return sshFileService.writeFile(req.body as SSHWriteFileRequest)
}))

app.post(`${API_PREFIX}/ssh/create-directory`, asyncHandler(async (req) => {
  return sshFileService.createDirectory(req.body as SSHCreateDirectoryRequest)
}))

app.post(`${API_PREFIX}/ssh/delete-file`, asyncHandler(async (req) => {
  return sshFileService.deleteFile(req.body as SSHDeleteFileRequest)
}))

app.post(`${API_PREFIX}/ssh/move-file`, asyncHandler(async (req) => {
  return sshFileService.moveFile(req.body as SSHMoveFileRequest)
}))

app.get(`${API_PREFIX}/ssh-terminal/events/data`, (req, res) => {
  attachSSEClient(req, res, terminalDataClients, getRequestSessionId(req))
})

app.get(`${API_PREFIX}/ssh-terminal/events/exit`, (req, res) => {
  attachSSEClient(req, res, terminalExitClients, getRequestSessionId(req))
})

app.post(`${API_PREFIX}/ssh-terminal/create`, asyncHandler(async (req) => {
  const payload = req.body as SSHTerminalCreateRequest
  const sessionId = getRequestSessionId(req)
  return sshTerminalService.createSession(payload, {
    onData: (event: SSHTerminalDataEvent) => broadcastSSE(terminalDataClients, sessionId, event),
    onExit: (event: SSHTerminalExitEvent) => broadcastSSE(terminalExitClients, sessionId, event)
  }, sessionId)
}))

app.post(`${API_PREFIX}/ssh-terminal/write`, asyncHandler(async (req) => {
  sshTerminalService.write(req.body as SSHTerminalWriteRequest, getRequestSessionId(req))
  return undefined
}))

app.post(`${API_PREFIX}/ssh-terminal/resize`, asyncHandler(async (req) => {
  sshTerminalService.resize(req.body as SSHTerminalResizeRequest, getRequestSessionId(req))
  return undefined
}))

app.post(`${API_PREFIX}/ssh-terminal/close`, asyncHandler(async (req) => {
  sshTerminalService.close(req.body as SSHTerminalCloseRequest, getRequestSessionId(req))
  return undefined
}))

if (existsSync(STATIC_INDEX_FILE)) {
  app.use(express.static(STATIC_DIST_DIR))
  app.use((req, res, next) => {
    if (req.path.startsWith(API_PREFIX)) {
      next()
      return
    }

    res.sendFile(STATIC_INDEX_FILE)
  })
}

const server = app.listen(PORT, HOST, () => {
  console.log(`[web] MySQL Compare web server listening on http://${HOST}:${PORT}`)
  if (existsSync(STATIC_INDEX_FILE)) {
    console.log(`[web] Serving static frontend from ${STATIC_DIST_DIR}`)
  } else {
    console.log('[web] Static frontend not found; run "npm run web:build" for production assets.')
  }
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown().finally(() => process.exit(0))
  })
}

type AsyncRouteHandler = (req: Request, res: Response) => Promise<unknown>

function asyncHandler(handler: AsyncRouteHandler) {
  return (req: Request, res: Response): void => {
    void handler(req, res)
      .then((data) => {
        if (res.headersSent) return
        sendOK(res, data as unknown)
      })
      .catch((error) => {
        if (res.headersSent) return
        sendError(res, error)
      })
  }
}

function sendOK<T>(res: Response, data: T): void {
  const body: IPCResult<T> = { ok: true, data }
  res.json(body)
}

function sendError(res: Response, error: unknown, status = 500): void {
  const body: IPCResult = {
    ok: false,
    error: (error as Error).message || 'Unknown error'
  }
  res.status(status).json(body)
}

function attachSSEClient(
  req: Request,
  res: Response,
  buckets: Map<string, Set<Response>>,
  sessionId: string
): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  res.write(': connected\n\n')

  const bucket = buckets.get(sessionId) ?? new Set<Response>()
  bucket.add(res)
  buckets.set(sessionId, bucket)
  req.on('close', () => {
    bucket.delete(res)
    if (bucket.size === 0) buckets.delete(sessionId)
    res.end()
  })
}

function broadcastSSE<T>(buckets: Map<string, Set<Response>>, sessionId: string, event: T | null): void {
  const bucket = buckets.get(sessionId)
  if (!bucket) return
  const payload = event === null ? ': heartbeat\n\n' : `data: ${JSON.stringify(event)}\n\n`
  for (const client of Array.from(bucket)) {
    try {
      client.write(payload)
    } catch {
      bucket.delete(client)
      client.end()
    }
  }
  if (bucket.size === 0) buckets.delete(sessionId)
}

function broadcastAllSSE<T>(buckets: Map<string, Set<Response>>, event: T | null): void {
  for (const sessionId of buckets.keys()) broadcastSSE(buckets, sessionId, event)
}

function getExportMimeType(format: ExportTableRequest['format'] | 'sql'): string {
  if (format === 'csv') return 'text/csv; charset=utf-8'
  return 'text/plain; charset=utf-8'
}

function toAttachmentHeader(fileName: string): string {
  return `attachment; filename="${sanitizeFileName(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

async function withTempFile(fileName: string, fn: (filePath: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'mysql-compare-web-'))
  const filePath = join(directory, sanitizeFileName(fileName))
  try {
    await fn(filePath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function getParam(req: Request, key: string): string {
  const value = req.params[key]
  return decodeURIComponent(Array.isArray(value) ? value[0] || '' : value || '')
}

async function shutdown(): Promise<void> {
  clearInterval(heartbeat)
  closeSSEClients(syncClients)
  closeSSEClients(terminalDataClients)
  closeSSEClients(terminalExitClients)
  sshTerminalService.closeAll()
  await Promise.allSettled([dbService.closeAll(), sshService.closeAll()])
  await new Promise<void>((resolveClose) => {
    server.close(() => resolveClose())
  })
}

function closeSSEClients(buckets: Map<string, Set<Response>>): void {
  for (const bucket of buckets.values()) bucket.forEach((client) => client.end())
  buckets.clear()
}
