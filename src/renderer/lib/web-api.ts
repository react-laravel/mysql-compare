import type { AppAPI } from '../../shared/app-api'
import type {
  ConnectionConfig,
  CopyTableRequest,
  DatabaseDiff,
  DatabaseInfo,
  DiffRequest,
  DeleteRowsRequest,
  DropDatabaseRequest,
  DropTableRequest,
  ExportDatabaseRequest,
  ExportDatabaseResult,
  ExplainSQLRequest,
  ExplainSQLResult,
  ExportTableRequest,
  ExportTableResult,
  ImportTableRequest,
  ImportTableResult,
  InsertRowRequest,
  IPCResult,
  QueryRowsRequest,
  QueryRowsResult,
  RenameTableRequest,
  SafeConnection,
  SSHCreateDirectoryRequest,
  SSHDeleteFileRequest,
  SSHDownloadDirectoryRequest,
  SSHDownloadFileRequest,
  SSHFileOperationResult,
  SSHListFilesRequest,
  SSHListFilesResult,
  SSHMoveFileRequest,
  SSHReadFileRequest,
  SSHReadFileResult,
  SSHUploadDirectoryRequest,
  SSHUploadEntriesRequest,
  SSHUploadFileRequest,
  SSHWriteFileRequest,
  SSHTerminalCloseRequest,
  SSHTerminalCreateRequest,
  SSHTerminalCreateResult,
  SSHTerminalDataEvent,
  SSHTerminalExitEvent,
  SSHTerminalResizeRequest,
  SSHTerminalWriteRequest,
  SyncPlan,
  SyncProgressEvent,
  SyncRequest,
  TableComparisonResult,
  TableDiffRequest,
  TableSchema,
  TruncateTableRequest,
  UpdateRowRequest
} from '../../shared/types'

const WEB_API_BASE = (import.meta.env.VITE_WEB_API_BASE || '/api').replace(/\/$/, '')

interface BrowserUploadFile {
  relativePath: string
  contentBase64: string
}

type BrowserFile = File
type BrowserDirectoryInput = HTMLInputElement

function makeUrl(path: string): string {
  return `${WEB_API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

async function request<T>(path: string, init?: RequestInit): Promise<IPCResult<T>> {
  try {
    const response = await fetch(makeUrl(path), {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(typeof init?.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {})
      },
      ...init
    })

    if (!response.headers.get('content-type')?.includes('application/json')) {
      return {
        ok: false,
        error: response.ok ? 'Unexpected response type' : response.statusText || 'Request failed'
      }
    }

    const result = (await response.json()) as IPCResult<T>
    if (!response.ok && result.ok) {
      return { ok: false, error: response.statusText || 'Request failed' }
    }
    return result
  } catch (error) {
    return { ok: false, error: (error as Error).message || 'Network error' }
  }
}

function get<T>(path: string): Promise<IPCResult<T>> {
  return request<T>(path, { method: 'GET' })
}

function post<T>(path: string, body?: unknown): Promise<IPCResult<T>> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

function del<T>(path: string, body?: unknown): Promise<IPCResult<T>> {
  return request<T>(path, {
    method: 'DELETE',
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

function subscribeToEvents<T>(path: string, onEvent: (value: T) => void): () => void {
  const source = new EventSource(makeUrl(path), { withCredentials: true })
  source.onmessage = (event) => {
    onEvent(JSON.parse(event.data) as T)
  }
  source.onerror = () => {
    source.close()
  }
  return () => source.close()
}

function unsupportedPathForFile(_file: File): string {
  return ''
}

async function parseErrorResponse<T>(response: Response): Promise<IPCResult<T>> {
  if (response.headers.get('content-type')?.includes('application/json')) {
    return (await response.json()) as IPCResult<T>
  }

  return {
    ok: false,
    error: response.statusText || 'Request failed'
  }
}

function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function postAndDownload(path: string, body: unknown): Promise<Response> {
  const response = await fetch(makeUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/octet-stream,application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const error = await parseErrorResponse(response)
    throw new Error(error.error || 'Download failed')
  }

  return response
}

function getDownloadName(response: Response, fallbackName: string): string {
  return decodeURIComponent(response.headers.get('X-Download-Name') || fallbackName)
}

async function exportTableDownload(req: ExportTableRequest): Promise<IPCResult<ExportTableResult>> {
  try {
    const response = await postAndDownload('/db/export-table', req)
    if (response.headers.get('content-type')?.includes('application/json')) {
      return (await response.json()) as IPCResult<ExportTableResult>
    }

    const fileName = getDownloadName(response, `${req.table}.${req.format === 'sql' ? 'sql' : req.format}`)
    triggerBrowserDownload(await response.blob(), fileName)
    return {
      ok: true,
      data: {
        canceled: false,
        filePath: fileName,
        rowsExported: Number(response.headers.get('X-Rows-Exported') || '0')
      }
    }
  } catch (error) {
    return { ok: false, error: (error as Error).message || 'Export failed' }
  }
}

async function exportDatabaseDownload(req: ExportDatabaseRequest): Promise<IPCResult<ExportDatabaseResult>> {
  try {
    const response = await postAndDownload('/db/export-database', req)
    if (response.headers.get('content-type')?.includes('application/json')) {
      return (await response.json()) as IPCResult<ExportDatabaseResult>
    }

    const fileName = getDownloadName(response, `${req.database}.sql`)
    triggerBrowserDownload(await response.blob(), fileName)
    return {
      ok: true,
      data: {
        canceled: false,
        filePath: fileName,
        tablesExported: Number(response.headers.get('X-Tables-Exported') || '0'),
        rowsExported: Number(response.headers.get('X-Rows-Exported') || '0'),
        backend: (response.headers.get('X-Export-Backend') as ExportDatabaseResult['backend']) || 'builtin',
        rowsCountAccurate: response.headers.get('X-Rows-Count-Accurate') !== 'false'
      }
    }
  } catch (error) {
    return { ok: false, error: (error as Error).message || 'Export failed' }
  }
}

async function downloadSSHFile(req: SSHDownloadFileRequest): Promise<IPCResult<SSHFileOperationResult>> {
  try {
    const response = await postAndDownload('/ssh/download-file', req)
    if (response.headers.get('content-type')?.includes('application/json')) {
      return (await response.json()) as IPCResult<SSHFileOperationResult>
    }

    const fallbackName = req.remotePath.split('/').filter(Boolean).pop() || 'download'
    const fileName = getDownloadName(response, fallbackName)
    triggerBrowserDownload(await response.blob(), fileName)
    return {
      ok: true,
      data: {
        canceled: false,
        localPath: fileName,
        remotePath: req.remotePath
      }
    }
  } catch (error) {
    return { ok: false, error: (error as Error).message || 'Download failed' }
  }
}

async function pickFiles(options: {
  multiple?: boolean
  directory?: boolean
  accept?: string
} = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input') as BrowserDirectoryInput
    input.type = 'file'
    input.multiple = options.multiple ?? false
    if (options.accept) input.accept = options.accept
    if (options.directory) input.webkitdirectory = true

    let settled = false
    const finish = (files: File[]) => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onWindowFocus)
      resolve(files)
    }
    const onWindowFocus = () => {
      window.setTimeout(() => {
        if (!settled) finish([])
      }, 0)
    }

    input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true })
    window.addEventListener('focus', onWindowFocus, { once: true })
    input.click()
  })
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

async function uploadBrowserFiles(
  path: string,
  payload: { connectionId: string; remoteDir: string },
  files: File[],
  preserveRelativePaths = false
): Promise<IPCResult<SSHFileOperationResult>> {
  if (files.length === 0) {
    return { ok: true, data: { canceled: true } }
  }

  const browserFiles = await Promise.all(
    files.map(async (file) => {
      const browserFile = file as BrowserFile
      return {
        relativePath: preserveRelativePaths && browserFile.webkitRelativePath
          ? browserFile.webkitRelativePath
          : file.name,
        contentBase64: await fileToBase64(file)
      } satisfies BrowserUploadFile
    })
  )

  return post<SSHFileOperationResult>(path, {
    ...payload,
    files: browserFiles
  })
}

export function createWebApi(): AppAPI {
  return {
    runtime: {
      mode: 'web',
      supportsNativeFilePicker: false,
      supportsDirectoryUpload: true,
      supportsTerminalStreaming: true,
      supportsDownload: true
    },
    connection: {
      list: () => get<SafeConnection[]>('/connections'),
      upsert: (conn: ConnectionConfig) => post<SafeConnection>('/connections', conn),
      remove: (id: string) => del<void>(`/connections/${encodeURIComponent(id)}`),
      test: (conn: ConnectionConfig) => post<{ message: string }>('/connections/test', conn)
    },
    db: {
      listDatabases: (connectionId: string) => get<string[]>(`/db/${encodeURIComponent(connectionId)}/databases`),
      getDatabaseInfo: (connectionId: string, database: string) =>
        get<DatabaseInfo>(`/db/${encodeURIComponent(connectionId)}/databases/${encodeURIComponent(database)}`),
      listTables: (connectionId: string, database: string) =>
        get<string[]>(`/db/${encodeURIComponent(connectionId)}/databases/${encodeURIComponent(database)}/tables`),
      queryRows: (req: QueryRowsRequest) => post<QueryRowsResult>('/db/query-rows', req),
      insertRow: (req: InsertRowRequest) => post('/db/insert-row', req),
      updateRow: (req: UpdateRowRequest) => post('/db/update-row', req),
      deleteRows: (req: DeleteRowsRequest) => post('/db/delete-rows', req),
      executeSQL: (connectionId: string, sql: string, database?: string) =>
        post('/db/execute-sql', { connectionId, sql, database }),
      explainSQL: (req: ExplainSQLRequest) => post<ExplainSQLResult>('/db/explain-sql', req),
      renameTable: (req: RenameTableRequest) => post<{ table: string }>('/db/rename-table', req),
      copyTable: (req: CopyTableRequest) => post<{ table: string }>('/db/copy-table', req),
      dropDatabase: (req: DropDatabaseRequest) => post<void>('/db/drop-database', req),
      dropTable: (req: DropTableRequest) => post<void>('/db/drop-table', req),
      truncateTable: (req: TruncateTableRequest) => post<void>('/db/truncate-table', req),
      exportTable: (req: ExportTableRequest) => exportTableDownload(req),
      exportDatabase: (req: ExportDatabaseRequest) => exportDatabaseDownload(req),
      importTable: (req: ImportTableRequest) => post<ImportTableResult>('/db/import-table', req)
    },
    schema: {
      getTable: (connectionId: string, database: string, table: string) =>
        get<TableSchema>(
          `/schema/${encodeURIComponent(connectionId)}/${encodeURIComponent(database)}/${encodeURIComponent(table)}`
        )
    },
    ssh: {
      listFiles: (req: SSHListFilesRequest) => post<SSHListFilesResult>('/ssh/list-files', req),
      uploadFile: async (req: SSHUploadFileRequest) => {
        const files = await pickFiles({ multiple: false })
        return uploadBrowserFiles('/ssh/upload-file', req, files)
      },
      uploadDirectory: async (req: SSHUploadDirectoryRequest) => {
        const files = await pickFiles({ multiple: true, directory: true })
        return uploadBrowserFiles('/ssh/upload-directory', req, files, true)
      },
      uploadEntries: (_req: SSHUploadEntriesRequest) =>
        Promise.resolve({
          ok: false,
          error: 'Drag-and-drop SSH upload is unavailable in web mode. Use Upload File or Upload Folder instead.'
        }),
      downloadFile: (req: SSHDownloadFileRequest) => downloadSSHFile(req),
      downloadDirectory: (_req: SSHDownloadDirectoryRequest) =>
        Promise.resolve({ ok: false, error: 'Directory download is not yet supported in web mode.' }),
      readFile: (req: SSHReadFileRequest) => post<SSHReadFileResult>('/ssh/read-file', req),
      writeFile: (req: SSHWriteFileRequest) => post<SSHFileOperationResult>('/ssh/write-file', req),
      createDirectory: (req: SSHCreateDirectoryRequest) => post<SSHFileOperationResult>('/ssh/create-directory', req),
      deleteFile: (req: SSHDeleteFileRequest) => post<SSHFileOperationResult>('/ssh/delete-file', req),
      moveFile: (req: SSHMoveFileRequest) => post<SSHFileOperationResult>('/ssh/move-file', req),
      createTerminal: (req: SSHTerminalCreateRequest) => post<SSHTerminalCreateResult>('/ssh-terminal/create', req),
      writeTerminal: (req: SSHTerminalWriteRequest) => post<void>('/ssh-terminal/write', req),
      resizeTerminal: (req: SSHTerminalResizeRequest) => post<void>('/ssh-terminal/resize', req),
      closeTerminal: (req: SSHTerminalCloseRequest) => post<void>('/ssh-terminal/close', req),
      onTerminalData: (cb: (event: SSHTerminalDataEvent) => void) =>
        subscribeToEvents<SSHTerminalDataEvent>('/ssh-terminal/events/data', cb),
      onTerminalExit: (cb: (event: SSHTerminalExitEvent) => void) =>
        subscribeToEvents<SSHTerminalExitEvent>('/ssh-terminal/events/exit', cb)
    },
    system: {
      getPathForFile: unsupportedPathForFile
    },
    diff: {
      databases: (req: DiffRequest) => post<DatabaseDiff>('/diff/databases', req),
      table: (req: TableDiffRequest) => post<TableComparisonResult>('/diff/table', req)
    },
    sync: {
      buildPlan: (req: SyncRequest) => post<SyncPlan>('/sync/build-plan', req),
      execute: (req: SyncRequest) => post<{ executed: number; errors: number }>('/sync/execute', req),
      onProgress: (cb: (event: SyncProgressEvent) => void) =>
        subscribeToEvents<SyncProgressEvent>('/sync/events/progress', cb)
    }
  }
}
