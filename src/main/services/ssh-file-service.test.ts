import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  Client,
  clients,
  localReaddir,
  sftp,
  mkdir,
  showOpenDialog,
  showSaveDialog,
  showMessageBox,
  getFull,
  getFingerprint,
  setFingerprint,
  createSSHHostVerifier
} = vi.hoisted(() => {
  const sftp = {
    readdir: vi.fn(),
    fastPut: vi.fn(),
    fastGet: vi.fn(),
    lstat: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    rmdir: vi.fn()
  }
  const clients: Array<{
    once: ReturnType<typeof vi.fn>
    connect: ReturnType<typeof vi.fn>
    sftp: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
    ready?: () => void
    error?: (error: Error) => void
  }> = []
  const Client = vi.fn(function () {
    const client = {
      once: vi.fn((event: string, cb: (error?: Error) => void) => {
        if (event === 'ready') client.ready = cb as () => void
        if (event === 'error') client.error = cb as (error: Error) => void
        return client
      }),
      connect: vi.fn((config: { hostVerifier?: (key: Buffer, verify: (verified: boolean) => void) => void }) => {
        if (!config.hostVerifier) {
          client.ready?.()
          return
        }
        config.hostVerifier(Buffer.from('host-key'), (verified) => {
          if (verified) client.ready?.()
          else client.error?.(new Error('Host verification failed'))
        })
      }),
      sftp: vi.fn((cb: (error: Error | undefined, wrapper: typeof sftp) => void) => cb(undefined, sftp)),
      end: vi.fn(),
      ready: undefined as (() => void) | undefined,
      error: undefined as ((error: Error) => void) | undefined
    }
    clients.push(client)
    return client
  })

  return {
    Client,
    clients,
    localReaddir: vi.fn(),
    sftp,
    mkdir: vi.fn(async () => undefined),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
    getFull: vi.fn(),
    getFingerprint: vi.fn(),
    setFingerprint: vi.fn(),
    createSSHHostVerifier: vi.fn()
  }
})

vi.mock('ssh2', () => ({ Client }))

vi.mock('node:fs/promises', () => ({
  readdir: localReaddir,
  mkdir
}))

vi.mock('../platform/electron-runtime', () => ({
  showOpenDialog,
  showSaveDialog
}))

vi.mock('../store/connection-store', () => ({
  connectionStore: {
    getFull
  }
}))

vi.mock('../store/ssh-host-key-store', () => ({
  sshHostKeyStore: {
    get: getFingerprint,
    set: setFingerprint
  }
}))

vi.mock('./ssh-host-verifier', () => ({ createSSHHostVerifier }))

import { sshFileService } from './ssh-file-service'

describe('SSHFileService', () => {
  beforeEach(() => {
    Client.mockClear()
    clients.length = 0
    sftp.readdir.mockReset()
    sftp.fastPut.mockReset()
    sftp.fastGet.mockReset()
    sftp.lstat.mockReset()
    sftp.readFile.mockReset()
    sftp.writeFile.mockReset()
    sftp.mkdir.mockReset()
    sftp.rename.mockReset()
    sftp.unlink.mockReset()
    sftp.rmdir.mockReset()
    localReaddir.mockReset()
    showOpenDialog.mockReset()
    showSaveDialog.mockReset()
    showMessageBox.mockReset()
    getFull.mockReset()
    getFingerprint.mockReset()
    setFingerprint.mockReset()
    createSSHHostVerifier.mockReset()
    createSSHHostVerifier.mockReturnValue((_key: Buffer, verify: (verified: boolean) => void) => verify(true))
    showMessageBox.mockResolvedValue({ response: 0 })
    getFull.mockReturnValue({
      id: 'conn-1',
      engine: 'mysql',
      name: 'Server',
      host: 'db.internal',
      port: 3306,
      username: 'dbuser',
      useSSH: true,
      sshHost: 'ssh.internal',
      sshPort: 22,
      sshUsername: 'deploy',
      sshPassword: 'secret',
      createdAt: 1,
      updatedAt: 1
    })
  })

  it('lists remote files sorted with directories first', async () => {
    sftp.readdir.mockImplementation((_path, cb) => {
      cb(undefined, [
        createItem('app.log', 'file', 2048),
        createItem('releases', 'directory', 0),
        createItem('.', 'directory', 0)
      ])
    })

    const result = await sshFileService.listFiles({ connectionId: 'conn-1', path: '/var/www' })

    expect(result).toEqual({
      path: '/var/www',
      parentPath: '/var',
      entries: [
        expect.objectContaining({ name: 'releases', path: '/var/www/releases', type: 'directory' }),
        expect.objectContaining({ name: 'app.log', path: '/var/www/app.log', type: 'file', size: 2048 })
      ]
    })
    expect(Client).toHaveBeenCalledTimes(1)
    expect(clients[0]?.connect).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'ssh.internal', username: 'deploy', password: 'secret' })
    )
    expect(createSSHHostVerifier).toHaveBeenCalledWith(expect.objectContaining({ id: 'conn-1' }))
    expect(clients[0]?.connect).toHaveBeenCalledWith(expect.objectContaining({ hostVerifier: expect.any(Function) }))
    expect(clients[0]?.end).toHaveBeenCalledTimes(1)
  })

  it('uploads a selected local file into the current remote directory', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/app.sql'] })
    sftp.fastPut.mockImplementation((_local, _remote, cb) => cb(undefined))

    const result = await sshFileService.uploadFile({ connectionId: 'conn-1', remoteDir: '/backup' })

    expect(result).toEqual({ canceled: false, localPath: '/tmp/app.sql', remotePath: '/backup/app.sql' })
    expect(sftp.fastPut).toHaveBeenCalledWith('/tmp/app.sql', '/backup/app.sql', expect.any(Function))
  })

  it('downloads a remote file to the selected local path', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/Users/sam/app.sql' })
    sftp.fastGet.mockImplementation((_remote, _local, cb) => cb(undefined))

    const result = await sshFileService.downloadFile({ connectionId: 'conn-1', remotePath: '/backup/app.sql' })

    expect(result).toEqual({ canceled: false, localPath: '/Users/sam/app.sql', remotePath: '/backup/app.sql' })
    expect(sftp.fastGet).toHaveBeenCalledWith('/backup/app.sql', '/Users/sam/app.sql', expect.any(Function))
  })

  it('preserves explicit remote paths with trailing spaces', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/Users/sam/report.txt' })
    sftp.fastGet.mockImplementation((_remote, _local, cb) => cb(undefined))

    const result = await sshFileService.downloadFile({ connectionId: 'conn-1', remotePath: '/backup/report.txt ' })

    expect(result.remotePath).toBe('/backup/report.txt ')
    expect(sftp.fastGet).toHaveBeenCalledWith('/backup/report.txt ', '/Users/sam/report.txt', expect.any(Function))
  })

  it('reads and writes a remote text file', async () => {
    sftp.readFile.mockImplementation((_path, cb) => cb(undefined, Buffer.from('hello world')))
    sftp.writeFile.mockImplementation((_path, _content, _encoding, cb) => cb(undefined))

    await expect(
      sshFileService.readFile({ connectionId: 'conn-1', remotePath: '/backup/app.sql' })
    ).resolves.toEqual({ path: '/backup/app.sql', content: 'hello world' })
    await expect(
      sshFileService.writeFile({ connectionId: 'conn-1', remotePath: '/backup/app.sql', content: 'select 1;' })
    ).resolves.toEqual({ canceled: false, remotePath: '/backup/app.sql' })

    expect(sftp.readFile).toHaveBeenCalledWith('/backup/app.sql', expect.any(Function))
    expect(sftp.writeFile).toHaveBeenCalledWith('/backup/app.sql', 'select 1;', 'utf8', expect.any(Function))
  })

  it('rejects binary file content in SSH editor reads', async () => {
    sftp.readFile.mockImplementation((_path, cb) => cb(undefined, Buffer.from([0, 159, 146, 150])))

    await expect(
      sshFileService.readFile({ connectionId: 'conn-1', remotePath: '/backup/app.bin' })
    ).rejects.toThrow('Binary files are not supported in the SSH editor')
  })

  it('downloads a remote directory recursively', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/Users/sam/Downloads'] })
    sftp.readdir.mockImplementation((path, cb) => {
      if (path === '/backup/releases') {
        cb(undefined, [createItem('app.sql', 'file', 16)])
        return
      }
      cb(undefined, [
        createItem('releases', 'directory', 0),
        createItem('README.md', 'file', 8)
      ])
    })
    sftp.fastGet.mockImplementation((_remote, _local, cb) => cb(undefined))

    const result = await sshFileService.downloadDirectory({ connectionId: 'conn-1', remotePath: '/backup' })

    expect(result).toEqual({
      canceled: false,
      localPath: '/Users/sam/Downloads/backup',
      remotePath: '/backup'
    })
    expect(mkdir).toHaveBeenNthCalledWith(1, '/Users/sam/Downloads/backup', { recursive: true })
    expect(mkdir).toHaveBeenNthCalledWith(2, '/Users/sam/Downloads/backup/releases', { recursive: true })
    expect(sftp.fastGet).toHaveBeenCalledWith(
      '/backup/README.md',
      '/Users/sam/Downloads/backup/README.md',
      expect.any(Function)
    )
    expect(sftp.fastGet).toHaveBeenCalledWith(
      '/backup/releases/app.sql',
      '/Users/sam/Downloads/backup/releases/app.sql',
      expect.any(Function)
    )
  })

  it('uploads a selected local directory recursively into the current remote directory', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/Users/sam/releases'] })
    localReaddir.mockImplementation(async (path, options?: { withFileTypes?: boolean }) => {
      expect(options).toEqual({ withFileTypes: true })
      if (path === '/Users/sam/releases') {
        return [
          createDirent('daily', 'directory'),
          createDirent('README.md', 'file')
        ]
      }
      if (path === '/Users/sam/releases/daily') {
        return [createDirent('app.sql', 'file')]
      }
      return []
    })
    sftp.mkdir.mockImplementation((_path, cb) => cb(undefined))
    sftp.fastPut.mockImplementation((_local, _remote, cb) => cb(undefined))

    const result = await sshFileService.uploadDirectory({ connectionId: 'conn-1', remoteDir: '/backup' })

    expect(result).toEqual({
      canceled: false,
      localPath: '/Users/sam/releases',
      remotePath: '/backup/releases'
    })
    expect(sftp.mkdir).toHaveBeenNthCalledWith(1, '/backup/releases', expect.any(Function))
    expect(sftp.mkdir).toHaveBeenNthCalledWith(2, '/backup/releases/daily', expect.any(Function))
    expect(sftp.fastPut).toHaveBeenCalledWith(
      '/Users/sam/releases/README.md',
      '/backup/releases/README.md',
      expect.any(Function)
    )
    expect(sftp.fastPut).toHaveBeenCalledWith(
      '/Users/sam/releases/daily/app.sql',
      '/backup/releases/daily/app.sql',
      expect.any(Function)
    )
  })

  it('uploads dropped files and directories using their relative paths', async () => {
    sftp.lstat.mockImplementation((_path, cb) => cb(new Error('No such file')))
    sftp.mkdir.mockImplementation((_path, cb) => cb(undefined))
    sftp.fastPut.mockImplementation((_local, _remote, cb) => cb(undefined))

    const result = await sshFileService.uploadEntries({
      connectionId: 'conn-1',
      remoteDir: '/backup',
      entries: [
        { type: 'directory', relativePath: 'releases' },
        { type: 'directory', relativePath: 'releases/daily' },
        { type: 'file', localPath: '/Users/sam/releases/README.md', relativePath: 'releases/README.md' },
        { type: 'file', localPath: '/Users/sam/releases/daily/app.sql', relativePath: 'releases/daily/app.sql' }
      ]
    })

    expect(result).toEqual({ canceled: false, remotePath: '/backup' })
    expect(sftp.mkdir).toHaveBeenNthCalledWith(1, '/backup/releases', expect.any(Function))
    expect(sftp.mkdir).toHaveBeenNthCalledWith(2, '/backup/releases/daily', expect.any(Function))
    expect(sftp.fastPut).toHaveBeenCalledWith(
      '/Users/sam/releases/README.md',
      '/backup/releases/README.md',
      expect.any(Function)
    )
    expect(sftp.fastPut).toHaveBeenCalledWith(
      '/Users/sam/releases/daily/app.sql',
      '/backup/releases/daily/app.sql',
      expect.any(Function)
    )
  })

  it('rejects dropped upload when a remote file already exists', async () => {
    sftp.lstat.mockImplementation((path, cb) => {
      if (path === '/backup/releases/README.md') {
        cb(undefined, { mode: 0o644, isFile: () => true, isDirectory: () => false })
        return
      }
      cb(new Error('No such file'))
    })

    await expect(
      sshFileService.uploadEntries({
        connectionId: 'conn-1',
        remoteDir: '/backup',
        entries: [{ type: 'file', localPath: '/Users/sam/releases/README.md', relativePath: 'releases/README.md' }]
      })
    ).rejects.toThrow('Destination already exists: /backup/releases/README.md')

    expect(sftp.mkdir).not.toHaveBeenCalled()
    expect(sftp.fastPut).not.toHaveBeenCalled()
  })

  it('rejects a changed SSH host fingerprint', async () => {
    createSSHHostVerifier.mockReturnValueOnce(
      (_key: Buffer, verify: (verified: boolean) => void) => verify(false)
    )

    await expect(sshFileService.listFiles({ connectionId: 'conn-1', path: '/var/www' })).rejects.toThrow(
      'Host verification failed'
    )

    expect(sftp.readdir).not.toHaveBeenCalled()
  })

  it('creates and deletes remote entries', async () => {
    sftp.mkdir.mockImplementation((_path, cb) => cb(undefined))
    sftp.unlink.mockImplementation((_path, cb) => cb(undefined))
    sftp.rmdir.mockImplementation((_path, cb) => cb(undefined))

    await expect(
      sshFileService.createDirectory({ connectionId: 'conn-1', remoteDir: '/backup', name: 'daily' })
    ).resolves.toEqual({ canceled: false, remotePath: '/backup/daily' })
    await expect(
      sshFileService.deleteFile({ connectionId: 'conn-1', remotePath: '/backup/app.sql', type: 'file' })
    ).resolves.toEqual({ canceled: false, remotePath: '/backup/app.sql' })
    await expect(
      sshFileService.deleteFile({ connectionId: 'conn-1', remotePath: '/backup/daily', type: 'directory' })
    ).resolves.toEqual({ canceled: false, remotePath: '/backup/daily' })

    expect(sftp.mkdir).toHaveBeenCalledWith('/backup/daily', expect.any(Function))
    expect(sftp.unlink).toHaveBeenCalledWith('/backup/app.sql', expect.any(Function))
    expect(sftp.rmdir).toHaveBeenCalledWith('/backup/daily', expect.any(Function))
  })

  it('moves or renames remote entries to an explicit destination path', async () => {
    sftp.lstat.mockImplementation((_path, cb) => cb(new Error('No such file')))
    sftp.rename.mockImplementation((_from, _to, cb) => cb(undefined))

    await expect(
      sshFileService.moveFile({
        connectionId: 'conn-1',
        remotePath: '/backup/app.sql',
        nextPath: '/archive/app-2026.sql '
      })
    ).resolves.toEqual({ canceled: false, remotePath: '/archive/app-2026.sql ' })

    expect(sftp.rename).toHaveBeenCalledWith(
      '/backup/app.sql',
      '/archive/app-2026.sql ',
      expect.any(Function)
    )
  })

  it('rejects move when the destination path already exists', async () => {
    sftp.lstat.mockImplementation((_path, cb) => cb(undefined, { mode: 0o644 }))

    await expect(
      sshFileService.moveFile({
        connectionId: 'conn-1',
        remotePath: '/backup/app.sql',
        nextPath: '/archive/app.sql'
      })
    ).rejects.toThrow('Destination already exists: /archive/app.sql')

    expect(sftp.rename).not.toHaveBeenCalled()
  })
})

function createItem(name: string, type: 'file' | 'directory', size: number) {
  return {
    filename: name,
    longname: name,
    attrs: {
      size,
      mtime: 1_771_000_000,
      mode: 0o755,
      isDirectory: () => type === 'directory',
      isFile: () => type === 'file',
      isSymbolicLink: () => false
    }
  }
}

function createDirent(name: string, type: 'file' | 'directory') {
  return {
    name,
    isDirectory: () => type === 'directory',
    isFile: () => type === 'file',
    isSymbolicLink: () => false
  }
}
