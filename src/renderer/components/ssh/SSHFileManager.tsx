import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Download,
  File,
  Folder,
  FolderPlus,
  RefreshCw,
  Trash2,
  Upload
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Table, TBody, Td, Th, THead, Tr } from '@renderer/components/ui/table'
import { api, unwrap } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import { useUIStore } from '@renderer/store/ui-store'
import { SSHMoveDialog } from './SSHMoveDialog'
import { getDroppedUploadEntries } from './ssh-drop-utils'
import type { SSHFileEntry, SSHListFilesResult } from '../../../shared/types'

interface SSHFileManagerProps {
  connectionId: string
  connectionName: string
}

export function SSHFileManager({ connectionId, connectionName }: SSHFileManagerProps) {
  const { t } = useI18n()
  const { confirmSSHPathTabRetarget, moveSSHPathTabs, setRightView, showToast } = useUIStore()
  const [currentPath, setCurrentPath] = useState('.')
  const [pathDraft, setPathDraft] = useState('.')
  const [listing, setListing] = useState<SSHListFilesResult | null>(null)
  const [selected, setSelected] = useState<SSHFileEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draggingUpload, setDraggingUpload] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [moveEntry, setMoveEntry] = useState<SSHFileEntry | null>(null)
  const dragDepth = useRef(0)
  const requestSeq = useRef(0)

  const entries = listing?.entries ?? []
  const selectedIsFile = selected?.type === 'file' || selected?.type === 'symlink'
  const selectedCanDownload = !!selected
  const selectedCanDelete = !!selected && selected.path !== '/' && selected.path !== '.'
  const selectedCanMove = selectedCanDelete

  const headerTitle = useMemo(
    () => `${t('sshFiles.title')} · ${connectionName}`,
    [connectionName, t]
  )

  const loadFiles = async (path = currentPath) => {
    const requestId = requestSeq.current + 1
    requestSeq.current = requestId
    setLoading(true)
    try {
      const result = await unwrap(api.ssh.listFiles({ connectionId, path }))
      if (requestSeq.current !== requestId) return
      setListing(result)
      setCurrentPath(result.path)
      setPathDraft(result.path)
      setSelected(null)
    } catch (error) {
      if (requestSeq.current !== requestId) return
      showToast((error as Error).message, 'error')
    } finally {
      if (requestSeq.current === requestId) setLoading(false)
    }
  }

  useEffect(() => {
    void loadFiles('.')
  }, [connectionId])

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      showToast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const submitPath = () => {
    if (busy || loading) return
    const nextPath = pathDraft || '.'
    void loadFiles(nextPath)
  }

  const uploadFile = () =>
    runAction(async () => {
      const result = await unwrap(api.ssh.uploadFile({ connectionId, remoteDir: currentPath }))
      if (!result.canceled) {
        showToast(t('sshFiles.toast.uploaded', { path: result.remotePath ?? '' }), 'success')
        await loadFiles(currentPath)
      }
    })

  const uploadDirectory = () =>
    runAction(async () => {
      const result = await unwrap(api.ssh.uploadDirectory({ connectionId, remoteDir: currentPath }))
      if (!result.canceled) {
        showToast(t('sshFiles.toast.uploadedDirectory', { path: result.remotePath ?? '' }), 'success')
        await loadFiles(currentPath)
      }
    })

  const uploadDroppedItems = (dataTransfer: DataTransfer) =>
    runAction(async () => {
      const remoteDir = currentPath
      const entries = await getDroppedUploadEntries(dataTransfer, api.system.getPathForFile)
      if (entries.length === 0) {
        showToast(t('sshFiles.toast.dropUnsupported'), 'error')
        return
      }

      const result = await unwrap(api.ssh.uploadEntries({ connectionId, remoteDir, entries }))
      showToast(
        t('sshFiles.toast.uploadedItems', {
          count: entries.length,
          path: result.remotePath ?? remoteDir
        }),
        'success'
      )
      await loadFiles(remoteDir)
    })

  const openSelected = () => {
    if (!selected) return
    if (!selectedIsFile) return
    setRightView({
      kind: 'ssh-editor',
      connectionId,
      connectionName,
      path: selected.path
    })
  }

  const downloadSelected = () => {
    if (!selected) return
    void runAction(async () => {
      const result =
        selected.type === 'directory'
          ? await unwrap(api.ssh.downloadDirectory({ connectionId, remotePath: selected.path }))
          : await unwrap(api.ssh.downloadFile({ connectionId, remotePath: selected.path }))
      if (!result.canceled) {
        const key = selected.type === 'directory' ? 'sshFiles.toast.downloadedDirectory' : 'sshFiles.toast.downloaded'
        showToast(t(key, { path: result.localPath ?? '' }), 'success')
      }
    })
  }

  const createFolder = () => {
    const name = newFolderName.trim()
    if (!name) {
      showToast(t('sshFiles.toast.folderNameRequired'), 'error')
      return
    }
    void runAction(async () => {
      await unwrap(api.ssh.createDirectory({ connectionId, remoteDir: currentPath, name }))
      setNewFolderName('')
      showToast(t('sshFiles.toast.folderCreated', { name }), 'success')
      await loadFiles(currentPath)
    })
  }

  const deleteSelected = () => {
    if (!selected) return
    if (!confirm(t('sshFiles.confirmDelete', { name: selected.name }))) return
    void runAction(async () => {
      await unwrap(api.ssh.deleteFile({ connectionId, remotePath: selected.path, type: selected.type }))
      showToast(t('sshFiles.toast.deleted', { name: selected.name }), 'success')
      await loadFiles(currentPath)
    })
  }

  const moveSelected = () => {
    if (!selectedCanMove || !selected) return
    setMoveEntry(selected)
  }

  const submitMove = ({ directory, name }: { directory: string; name: string }) => {
    if (!moveEntry) return
    if (!directory.trim()) {
      showToast(t('sshFiles.toast.destinationRequired'), 'error')
      return
    }
    if (!name.trim()) {
      showToast(t('sshFiles.toast.nameRequired'), 'error')
      return
    }

    const nextPath = buildRemotePath(directory, name)
    if (!confirmSSHPathTabRetarget(connectionId, moveEntry.path)) return

    void runAction(async () => {
      await unwrap(api.ssh.moveFile({ connectionId, remotePath: moveEntry.path, nextPath }))
      moveSSHPathTabs(connectionId, moveEntry.path, nextPath)
      setMoveEntry(null)
      showToast(t('sshFiles.toast.moved', { path: nextPath }), 'success')
      await loadFiles(currentPath)
    })
  }

  const openEntry = (entry: SSHFileEntry) => {
    if (busy || loading) return
    setSelected(entry)
    if (entry.type === 'directory') {
      void loadFiles(entry.path)
      return
    }
    if (entry.type !== 'file' && entry.type !== 'symlink') {
      return
    }
    setRightView({ kind: 'ssh-editor', connectionId, connectionName, path: entry.path })
  }

  const goParent = () => {
    if (busy || loading) return
    if (!listing?.parentPath) return
    void loadFiles(listing.parentPath)
  }

  const onDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer) || busy || loading) return
    event.preventDefault()
    dragDepth.current += 1
    setDraggingUpload(true)
  }

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer) || busy || loading) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDraggingUpload(true)
  }

  const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer) || busy || loading) return
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) {
      setDraggingUpload(false)
    }
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer) || busy || loading) return
    event.preventDefault()
    dragDepth.current = 0
    setDraggingUpload(false)
    void uploadDroppedItems(event.dataTransfer)
  }

  return (
    <div
      className={cn('flex h-full min-h-0 flex-col overflow-hidden bg-background', draggingUpload && 'bg-accent/10')}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="border-b border-border bg-card px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{headerTitle}</div>
            <div className="truncate text-xs text-muted-foreground">{currentPath}</div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            <Button size="sm" variant="outline" onClick={() => void loadFiles(currentPath)} disabled={loading || busy}>
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loading && 'animate-spin')} />
              {t('common.refresh')}
            </Button>
            <Button size="sm" variant="outline" onClick={uploadFile} disabled={loading || busy}>
              <Upload className="mr-1 h-3.5 w-3.5" />
              {t('sshFiles.uploadFile')}
            </Button>
            <Button size="sm" variant="outline" onClick={uploadDirectory} disabled={loading || busy}>
              <Folder className="mr-1 h-3.5 w-3.5" />
              {t('sshFiles.uploadFolder')}
            </Button>
            <Button size="sm" variant="outline" onClick={openSelected} disabled={loading || busy || !selectedIsFile}>
              {t('sshFiles.open')}
            </Button>
            <Button size="sm" variant="outline" onClick={downloadSelected} disabled={loading || busy || !selectedCanDownload}>
              <Download className="mr-1 h-3.5 w-3.5" />
              {t('sshFiles.download')}
            </Button>
            <Button size="sm" variant="outline" onClick={moveSelected} disabled={loading || busy || !selectedCanMove}>
              {t('sshFiles.move')}
            </Button>
            <Button size="sm" variant="outline" onClick={deleteSelected} disabled={loading || busy || !selectedCanDelete}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              {t('common.delete')}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={goParent} disabled={!listing?.parentPath || loading || busy} title={t('sshFiles.goParent')}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Input
            value={pathDraft}
            onChange={(event) => setPathDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitPath()
            }}
            className="h-8 flex-1 font-mono text-xs"
          />
          <Button size="sm" onClick={submitPath} disabled={loading || busy}>
            {t('common.apply')}
          </Button>
          <div className="flex w-56 items-center gap-1">
            <Input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') createFolder()
              }}
              placeholder={t('sshFiles.newFolderPlaceholder')}
              className="h-8 text-xs"
            />
            <Button size="icon" variant="outline" onClick={createFolder} disabled={loading || busy} title={t('sshFiles.newFolder')}>
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <THead>
            <Tr className="hover:bg-transparent">
              <Th>{t('common.name')}</Th>
              <Th className="w-28">{t('common.type')}</Th>
              <Th className="w-28 text-right">{t('sshFiles.size')}</Th>
              <Th className="w-36">{t('sshFiles.permissions')}</Th>
              <Th className="w-48">{t('sshFiles.modifiedAt')}</Th>
            </Tr>
          </THead>
          <TBody>
            {loading && (
              <Tr>
                <Td colSpan={5} className="py-8 text-center text-muted-foreground">
                  {t('common.loading')}
                </Td>
              </Tr>
            )}
            {!loading && entries.length === 0 && (
              <Tr>
                <Td colSpan={5} className="py-8 text-center text-muted-foreground">
                  {t('sshFiles.empty')}
                </Td>
              </Tr>
            )}
            {!loading && entries.map((entry) => (
              <Tr
                key={entry.path}
                className={cn(
                  'cursor-pointer',
                  selected?.path === entry.path && 'bg-accent hover:bg-accent'
                )}
                onClick={() => setSelected(entry)}
                onDoubleClick={() => openEntry(entry)}
              >
                <Td className="max-w-none">
                  <div className="flex min-w-0 items-center gap-2">
                    {entry.type === 'directory' ? (
                      <Folder className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
                    ) : (
                      <File className="h-4 w-4 shrink-0 text-sky-700 dark:text-sky-300" />
                    )}
                    <span className="truncate font-medium">{entry.name}</span>
                  </div>
                </Td>
                <Td>{t(`sshFiles.type.${entry.type}`)}</Td>
                <Td className="text-right tabular-nums">{entry.type === 'directory' ? '—' : formatBytes(entry.size)}</Td>
                <Td className="font-mono text-xs">{entry.permissions}</Td>
                <Td>{formatDate(entry.modifiedAt)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>

      <div className={cn('border-t border-border px-3 py-2 text-xs text-muted-foreground', draggingUpload && 'bg-accent/20 text-foreground')}>
        {draggingUpload ? t('sshFiles.dropActive') : t('sshFiles.dropHint')}
      </div>

      <SSHMoveDialog
        entry={moveEntry}
        open={!!moveEntry}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setMoveEntry(null)
        }}
        onConfirm={submitMove}
      />
    </div>
  )
}

function buildRemotePath(directory: string, name: string): string {
  if (directory === '/') return `/${name}`
  if (directory === '.') return name
  return directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`
}

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).includes('Files')
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

function formatDate(value: number | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}
