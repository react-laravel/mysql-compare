import type { OpenDialogOptions, SaveDialogOptions } from 'electron'
import { mkdir as mkdirLocal, readdir as readdirLocal } from 'node:fs/promises'
import { basename, join, posix } from 'node:path'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { connectionStore } from '../store/connection-store'
import { showOpenDialog, showSaveDialog } from '../platform/electron-runtime'
import { createSSHHostVerifier } from './ssh-host-verifier'
import type {
  ConnectionConfig,
  SSHCreateDirectoryRequest,
  SSHDeleteFileRequest,
  SSHDownloadDirectoryRequest,
  SSHDownloadFileRequest,
  SSHFileEntry,
  SSHFileEntryType,
  SSHFileOperationResult,
  SSHListFilesRequest,
  SSHListFilesResult,
  SSHMoveFileRequest,
  SSHReadFileRequest,
  SSHReadFileResult,
  SSHUploadEntry,
  SSHUploadEntriesRequest,
  SSHUploadDirectoryRequest,
  SSHUploadFileRequest,
  SSHWriteFileRequest,
} from '../../shared/types'

interface SFTPListItem {
  filename: string
  longname: string
  attrs: {
    size: number
    mtime: number
    mode: number
    isDirectory: () => boolean
    isFile: () => boolean
    isSymbolicLink: () => boolean
  }
}

interface BrowserUploadFile {
  relativePath: string
  contentBase64: string
}

class SSHFileService {
  async listFiles(req: SSHListFilesRequest): Promise<SSHListFilesResult> {
    this.validateConnectionId(req.connectionId)
    const remotePath = normalizeRemotePath(req.path)

    return this.withSFTP(req.connectionId, async (sftp) => {
      const items = await readdir(sftp, remotePath)
      const entries = items
        .filter((item) => item.filename !== '.' && item.filename !== '..')
        .map((item) => toFileEntry(remotePath, item))
        .sort(compareEntries)

      return {
        path: remotePath,
        parentPath: getParentPath(remotePath),
        entries
      }
    })
  }

  async uploadFile(req: SSHUploadFileRequest): Promise<SSHFileOperationResult> {
    this.validateConnectionId(req.connectionId)
    const remoteDir = normalizeRemotePath(req.remoteDir)
    const localPath = await pickOpenFilePath()
    if (!localPath) return { canceled: true }

    const remotePath = joinRemotePath(remoteDir, basename(localPath))
    await this.withSFTP(req.connectionId, (sftp) => fastPut(sftp, localPath, remotePath))

    return { canceled: false, localPath, remotePath }
  }

  async uploadDirectory(req: SSHUploadDirectoryRequest): Promise<SSHFileOperationResult> {
    this.validateConnectionId(req.connectionId)
    const remoteDir = normalizeRemotePath(req.remoteDir)
    const localPath = await pickDirectoryPath('Upload Folder')
    if (!localPath) return { canceled: true }

    const remotePath = joinRemotePath(remoteDir, basename(localPath))
    await this.withSFTP(req.connectionId, async (sftp) => {
      await mkdir(sftp, remotePath)
      await this.uploadDirectoryContents(sftp, localPath, remotePath)
    })

    return { canceled: false, localPath, remotePath }
  }

  async uploadEntries(req: SSHUploadEntriesRequest): Promise<SSHFileOperationResult> {
    this.validateConnectionId(req.connectionId)
    const remoteDir = normalizeRemotePath(req.remoteDir)
    const entries = normalizeUploadEntries(req.entries)
    if (entries.length === 0) throw new Error('No upload entries provided')

    await this.withSFTP(req.connectionId, async (sftp) => {
      const remoteDirectories = collectUploadDirectories(entries)
      for (const relativePath of remoteDirectories) {
        const remotePath = joinRemotePath(remoteDir, relativePath)
        const kind = await getRemotePathKind(sftp, remotePath)
        if (kind === 'file') {
          throw new Error(`Cannot create directory over existing file: ${remotePath}`)
        }
      }

      for (const entry of entries) {
        if (entry.type !== 'file') continue
        const remotePath = joinRemotePath(remoteDir, entry.relativePath)
        if ((await getRemotePathKind(sftp, remotePath)) !== 'missing') {
          throw new Error(`Destination already exists: ${remotePath}`)
        }
      }

      for (const relativePath of remoteDirectories) {
        await ensureRemoteDirectory(sftp, joinRemotePath(remoteDir, relativePath))
      }

      for (const entry of entries) {
        if (entry.type !== 'file') continue
        await fastPut(sftp, entry.localPath, joinRemotePath(remoteDir, entry.relativePath))
      }
    })

    return { canceled: false, remotePath: remoteDir }
  }

  async uploadBrowserFiles(req: {
    connectionId: string
    remoteDir: string
    files: BrowserUploadFile[]
  }): Promise<SSHFileOperationResult> {
    this.validateConnectionId(req.connectionId)
    const remoteDir = normalizeRemotePath(req.remoteDir)
    const files = normalizeBrowserUploadFiles(req.files)
    if (files.length === 0) throw new Error('No upload files provided')

    await this.withSFTP(req.connectionId, async (sftp) => {
      const remoteDirectories = collectBrowserUploadDirectories(files)
      for (const relativePath of remoteDirectories) {
        const remotePath = joinRemotePath(remoteDir, relativePath)
        const kind = await getRemotePathKind(sftp, remotePath)
        if (kind === 'file') {
          throw new Error(`Cannot create directory over existing file: ${remotePath}`)
        }
      }

      for (const file of files) {
        const remotePath = joinRemotePath(remoteDir, file.relativePath)
        if ((await getRemotePathKind(sftp, remotePath)) !== 'missing') {
          throw new Error(`Destination already exists: ${remotePath}`)
        }
      }

      for (const relativePath of remoteDirectories) {
        await ensureRemoteDirectory(sftp, joinRemotePath(remoteDir, relativePath))
      }

      for (const file of files) {
        const remotePath = joinRemotePath(remoteDir, file.relativePath)
        await writeBuffer(sftp, remotePath, Buffer.from(file.contentBase64, 'base64'))
      }
    })

    return { canceled: false, remotePath: remoteDir }
  }

  async downloadFile(req: SSHDownloadFileRequest): Promise<SSHFileOperationResult> {
    this.validateConnectionId(req.connectionId)
    const remotePath = normalizeRemotePath(req.remotePath)
    const localPath = await pickSaveFilePath(posix.basename(remotePath))
    if (!localPath) return { canceled: true }

    await this.withSFTP(req.connectionId, (sftp) => fastGet(sftp, remotePath, localPath))

    return { canceled: false, localPath, remotePath }
  }

  async downloadFileContent(req: SSHDownloadFileRequest): Promise<{ fileName: string; content: Buffer }> {
    this.validateConnectionId(req.connectionId)
    const remotePath = normalizeRemotePath(req.remotePath)

    return this.withSFTP(req.connectionId, async (sftp) => ({
      fileName: posix.basename(remotePath) || 'download',
      content: await readFileBuffer(sftp, remotePath)
    }))
  }

  async downloadDirectory(req: SSHDownloadDirectoryRequest): Promise<SSHFileOperationResult> {
    this.validateConnectionId(req.connectionId)
    const remotePath = normalizeRemotePath(req.remotePath)
    const localRoot = await pickDirectoryPath('Download Folder')
    if (!localRoot) return { canceled: true }

    const localPath = join(localRoot, basename(remotePath) || 'download')
    await mkdirLocal(localPath, { recursive: true })

    await this.withSFTP(req.connectionId, async (sftp) => {
      await this.downloadDirectoryContents(sftp, remotePath, localPath)
    })

    return { canceled: false, localPath, remotePath }
  }

  async readFile(req: SSHReadFileRequest): Promise<SSHReadFileResult> {
    this.validateConnectionId(req.connectionId)
    const remotePath = normalizeRemotePath(req.remotePath)

    return this.withSFTP(req.connectionId, async (sftp) => {
      const content = await readFile(sftp, remotePath)
      return { path: remotePath, content }
    })
  }

  async writeFile(req: SSHWriteFileRequest): Promise<SSHFileOperationResult> {
    this.validateConnectionId(req.connectionId)
    const remotePath = normalizeRemotePath(req.remotePath)

    await this.withSFTP(req.connectionId, (sftp) => writeFile(sftp, remotePath, req.content))

    return { canceled: false, remotePath }
  }

  async createDirectory(req: SSHCreateDirectoryRequest): Promise<SSHFileOperationResult> {
    this.validateConnectionId(req.connectionId)
    const name = req.name.trim()
    if (!name) throw new Error('Folder name is required')
    if (name.includes('/')) throw new Error('Folder name cannot contain /')

    const remotePath = joinRemotePath(normalizeRemotePath(req.remoteDir), name)
    await this.withSFTP(req.connectionId, (sftp) => mkdir(sftp, remotePath))

    return { canceled: false, remotePath }
  }

  async deleteFile(req: SSHDeleteFileRequest): Promise<SSHFileOperationResult> {
    this.validateConnectionId(req.connectionId)
    const remotePath = normalizeRemotePath(req.remotePath)
    if (remotePath === '/' || remotePath === '.') throw new Error('Cannot delete the current root path')

    await this.withSFTP(req.connectionId, (sftp) => {
      if (req.type === 'directory') return rmdir(sftp, remotePath)
      return unlink(sftp, remotePath)
    })

    return { canceled: false, remotePath }
  }

  async moveFile(req: SSHMoveFileRequest): Promise<SSHFileOperationResult> {
    this.validateConnectionId(req.connectionId)
    const remotePath = normalizeRemotePath(req.remotePath)
    const nextPath = normalizeRemotePath(req.nextPath)

    if (remotePath === '/' || remotePath === '.') throw new Error('Cannot move the current root path')
    if (!nextPath || nextPath === '/' || nextPath === '.') throw new Error('Destination path is required')

    if (remotePath === nextPath) {
      return { canceled: false, remotePath }
    }

    await this.withSFTP(req.connectionId, async (sftp) => {
      if (await pathExists(sftp, nextPath)) {
        throw new Error(`Destination already exists: ${nextPath}`)
      }

      await rename(sftp, remotePath, nextPath)
    })

    return { canceled: false, remotePath: nextPath }
  }

  private validateConnectionId(connectionId: string): void {
    if (!connectionId) throw new Error('Connection is required')
  }

  private async withSFTP<T>(connectionId: string, fn: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
    const conn = this.getSSHConnection(connectionId)
    const client = await connectSSH(buildSSHConfig(conn))

    try {
      const sftp = await openSFTP(client)
      return await fn(sftp)
    } finally {
      client.end()
    }
  }

  private async downloadDirectoryContents(sftp: SFTPWrapper, remoteDir: string, localDir: string): Promise<void> {
    const items = await readdir(sftp, remoteDir)

    for (const item of items) {
      if (item.filename === '.' || item.filename === '..') continue

      const remotePath = joinRemotePath(remoteDir, item.filename)
      const localPath = join(localDir, item.filename)

      if (item.attrs.isDirectory()) {
        await mkdirLocal(localPath, { recursive: true })
        await this.downloadDirectoryContents(sftp, remotePath, localPath)
        continue
      }

      await fastGet(sftp, remotePath, localPath)
    }
  }

  private async uploadDirectoryContents(sftp: SFTPWrapper, localDir: string, remoteDir: string): Promise<void> {
    const items = await readdirLocal(localDir, { withFileTypes: true })

    for (const item of items) {
      const localPath = join(localDir, item.name)
      const remotePath = joinRemotePath(remoteDir, item.name)

      if (item.isDirectory()) {
        await mkdir(sftp, remotePath)
        await this.uploadDirectoryContents(sftp, localPath, remotePath)
        continue
      }

      if (item.isFile()) {
        await fastPut(sftp, localPath, remotePath)
        continue
      }

      throw new Error(`Unsupported local entry for SSH upload: ${localPath}`)
    }
  }

  private getSSHConnection(connectionId: string): ConnectionConfig {
    const conn = connectionStore.getFull(connectionId)
    if (!conn) throw new Error(`Connection ${connectionId} not found`)
    if (!conn.useSSH) throw new Error('This connection does not use SSH')
    if (!conn.sshHost || !conn.sshUsername) throw new Error('SSH host and username are required')
    if (!conn.sshPassword && !conn.sshPrivateKey) throw new Error('SSH password or private key is required')
    return conn
  }
}

function buildSSHConfig(conn: ConnectionConfig): ConnectConfig {
  const base: ConnectConfig = {
    host: conn.sshHost,
    port: conn.sshPort || 22,
    username: conn.sshUsername,
    readyTimeout: 15000,
    keepaliveInterval: 30000,
    hostVerifier: createSSHHostVerifier(conn)
  }

  if (conn.sshPrivateKey) {
    return {
      ...base,
      privateKey: conn.sshPrivateKey,
      passphrase: conn.sshPassphrase
    }
  }

  return {
    ...base,
    password: conn.sshPassword
  }
}

function connectSSH(config: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    client.once('ready', () => resolve(client))
    client.once('error', reject)
    client.connect(config)
  })
}

function openSFTP(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(error)
        return
      }
      resolve(sftp)
    })
  })
}

function readdir(sftp: SFTPWrapper, remotePath: string): Promise<SFTPListItem[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (error, list) => {
      if (error) {
        reject(error)
        return
      }
      resolve(list as SFTPListItem[])
    })
  })
}

function lstat(sftp: SFTPWrapper, remotePath: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    sftp.lstat(remotePath, (error, stats) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stats)
    })
  })
}

async function pathExists(sftp: SFTPWrapper, remotePath: string): Promise<boolean> {
  return (await getRemotePathKind(sftp, remotePath)) !== 'missing'
}

async function ensureRemoteDirectory(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  if (await pathExists(sftp, remotePath)) return
  await mkdir(sftp, remotePath)
}

async function getRemotePathKind(sftp: SFTPWrapper, remotePath: string): Promise<'missing' | 'directory' | 'file' | 'other'> {
  try {
    const stats = await lstat(sftp, remotePath)
    if (hasStatsMethod(stats, 'isDirectory') && stats.isDirectory()) return 'directory'
    if (hasStatsMethod(stats, 'isFile') && stats.isFile()) return 'file'
    return 'other'
  } catch (error) {
    if (isMissingPathError(error)) return 'missing'
    throw error
  }
}

function fastPut(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function fastGet(sftp: SFTPWrapper, remotePath: string, localPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function readFile(sftp: SFTPWrapper, remotePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.readFile(remotePath, (error, data) => {
      if (error) {
        reject(error)
        return
      }
      if (looksBinary(data)) {
        reject(new Error('Binary files are not supported in the SSH editor'))
        return
      }
      resolve(data.toString('utf8'))
    })
  })
}

function readFileBuffer(sftp: SFTPWrapper, remotePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(remotePath, (error, data) => {
      if (error) {
        reject(error)
        return
      }
      resolve(Buffer.from(data))
    })
  })
}

function writeFile(sftp: SFTPWrapper, remotePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, content, 'utf8', (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function writeBuffer(sftp: SFTPWrapper, remotePath: string, content: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, content, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function looksBinary(data: Buffer): boolean {
  for (let index = 0; index < data.length; index += 1) {
    if (data[index] === 0) return true
  }
  return false
}

function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('no such') || message.includes('not found')
}

function hasStatsMethod<TMethod extends 'isDirectory' | 'isFile'>(
  stats: unknown,
  method: TMethod
): stats is Record<TMethod, () => boolean> {
  return !!stats && typeof (stats as Record<string, unknown>)[method] === 'function'
}

function normalizeUploadEntries(entries: SSHUploadEntriesRequest['entries']): SSHUploadEntriesRequest['entries'] {
  const seen = new Set<string>()
  const normalizedEntries: SSHUploadEntriesRequest['entries'] = []

  for (const entry of entries) {
    const relativePath = normalizeRelativeUploadPath(entry.relativePath)
    const key = `${entry.type}:${relativePath}`
    if (seen.has(key)) continue
    seen.add(key)

    if (entry.type === 'directory') {
      normalizedEntries.push({ type: 'directory', relativePath })
      continue
    }

    if (!entry.localPath) throw new Error(`Local path is required for upload file: ${relativePath}`)
    normalizedEntries.push({ type: 'file', localPath: entry.localPath, relativePath })
  }

  return normalizedEntries
}

function normalizeBrowserUploadFiles(files: BrowserUploadFile[]): BrowserUploadFile[] {
  const seen = new Set<string>()
  const normalizedFiles: BrowserUploadFile[] = []

  for (const file of files) {
    const relativePath = normalizeRelativeUploadPath(file.relativePath)
    if (!file.contentBase64) throw new Error(`Upload content is required: ${relativePath}`)
    if (seen.has(relativePath)) continue
    seen.add(relativePath)
    normalizedFiles.push({ relativePath, contentBase64: file.contentBase64 })
  }

  return normalizedFiles
}

function collectBrowserUploadDirectories(files: BrowserUploadFile[]): string[] {
  const directories = new Set<string>()

  for (const file of files) {
    let parentPath = posix.dirname(file.relativePath)
    while (parentPath && parentPath !== '.') {
      directories.add(parentPath)
      parentPath = posix.dirname(parentPath)
    }
  }

  return Array.from(directories).sort((left, right) => getPathDepth(left) - getPathDepth(right))
}

function normalizeRelativeUploadPath(value: string): string {
  const normalized = posix.normalize(value.replace(/\\/gu, '/')).replace(/^\/+/, '').replace(/^\.\//, '')
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Invalid upload path: ${value}`)
  }
  return normalized
}

function collectUploadDirectories(entries: SSHUploadEntriesRequest['entries']): string[] {
  const directories = new Set<string>()

  for (const entry of entries) {
    if (entry.type === 'directory') {
      directories.add(entry.relativePath)
      continue
    }

    let parentPath = posix.dirname(entry.relativePath)
    while (parentPath && parentPath !== '.') {
      directories.add(parentPath)
      parentPath = posix.dirname(parentPath)
    }
  }

  return Array.from(directories).sort((left, right) => getPathDepth(left) - getPathDepth(right))
}

function getPathDepth(path: string): number {
  return path.split('/').length
}

function mkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function unlink(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function rename(sftp: SFTPWrapper, remotePath: string, nextPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(remotePath, nextPath, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function rmdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(remotePath, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function normalizeRemotePath(value: string | undefined): string {
  if (value === undefined || value === '') return '.'
  const normalized = posix.normalize(value)
  if (value.startsWith('/') && normalized !== '/') return `/${normalized.replace(/^\/+/u, '')}`
  return normalized
}

function joinRemotePath(base: string, name: string): string {
  if (base === '/') return `/${name}`
  if (base === '.') return name
  return posix.join(base, name)
}

function getParentPath(remotePath: string): string | null {
  if (remotePath === '/' || remotePath === '.') return null
  const parent = posix.dirname(remotePath)
  return parent === remotePath ? null : parent
}

function toFileEntry(basePath: string, item: SFTPListItem): SSHFileEntry {
  return {
    name: item.filename,
    path: joinRemotePath(basePath, item.filename),
    type: getEntryType(item),
    size: item.attrs.size,
    modifiedAt: item.attrs.mtime ? item.attrs.mtime * 1000 : null,
    permissions: formatPermissions(item.attrs.mode)
  }
}

function getEntryType(item: SFTPListItem): SSHFileEntryType {
  if (item.attrs.isDirectory()) return 'directory'
  if (item.attrs.isFile()) return 'file'
  if (item.attrs.isSymbolicLink()) return 'symlink'
  return 'other'
}

function compareEntries(left: SSHFileEntry, right: SSHFileEntry): number {
  if (left.type === 'directory' && right.type !== 'directory') return -1
  if (left.type !== 'directory' && right.type === 'directory') return 1
  return left.name.localeCompare(right.name)
}

function formatPermissions(mode: number): string {
  return `0${(mode & 0o777).toString(8)}`
}

async function pickOpenFilePath(): Promise<string | undefined> {
  const options: OpenDialogOptions = {
    title: 'Upload File',
    properties: ['openFile']
  }
  const result = await showOpenDialog(options)
  return result.canceled ? undefined : result.filePaths[0]
}

async function pickSaveFilePath(defaultPath: string): Promise<string | undefined> {
  const options: SaveDialogOptions = {
    title: 'Download File',
    defaultPath
  }
  const result = await showSaveDialog(options)
  return result.canceled ? undefined : result.filePath
}

async function pickDirectoryPath(title: string): Promise<string | undefined> {
  const options: OpenDialogOptions = {
    title,
    properties: ['openDirectory', 'createDirectory']
  }
  const result = await showOpenDialog(options)
  return result.canceled ? undefined : result.filePaths[0]
}

export const sshFileService = new SSHFileService()
