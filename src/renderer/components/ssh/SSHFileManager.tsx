// SFTP 文件管理（blueprint §3.7）。
//
// 旧版把 7 个平铺按钮塞在一行，全部只作用于"当前选中行"，而选中只有一个淡色
// 背景在提示。现在是：`Toolbar`（Refresh · Upload ▾ · Download · ⋯）+ 面包屑/
// 过滤行 + `DataTable`，每一行常驻一个 `⋯`，所以动作和对象在同一处。
// 删除走 `ConfirmDialog`，不再是 `window.confirm`。
import { useMemo, useRef, useState } from 'react'
import {
  Download,
  FilePen,
  FolderPlus,
  FolderUp,
  PencilLine,
  Trash2,
  Upload
} from 'lucide-react'
import { ConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import type { MenuItem } from '@renderer/components/ui/dropdown-menu'
import { api, unwrap } from '@renderer/lib/api'
import { useAppAction } from '@renderer/lib/app-actions'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import { useUIStore } from '@renderer/store/ui-store'
import { SSHMoveDialog } from './SSHMoveDialog'
import { SSHNewFolderDialog } from './SSHNewFolderDialog'
import { SSHFileTable } from './SSHFileTable'
import { SSHFileToolbar } from './SSHFileToolbar'
import { buildSSHRemotePath, hasDraggedFiles } from './ssh-file-path'
import { getDroppedUploadEntries } from './ssh-drop-utils'
import { useSSHFileListing } from './useSSHFileListing'
import type { SSHFileEntry } from '../../../shared/types'

interface SSHFileManagerProps {
  connectionId: string
  connectionName: string
  /** 多标签同时挂载，未激活的视图不能抢 ⌘F / ⌘R */
  active?: boolean
}

interface PendingMove {
  entry: SSHFileEntry
  nextPath: string
}

export function SSHFileManager({ connectionId, connectionName, active = true }: SSHFileManagerProps) {
  const { t } = useI18n()
  const { hasUnsavedSSHPathTabs, moveSSHPathTabs, setRightView, showToast } = useUIStore()
  const {
    currentPath,
    pathDraft,
    setPathDraft,
    editingPath,
    setEditingPath,
    listing,
    selected,
    setSelected,
    loading,
    loadError,
    loadFiles
  } = useSSHFileListing(connectionId)
  const [busy, setBusy] = useState(false)
  const [draggingUpload, setDraggingUpload] = useState(false)
  const [filter, setFilter] = useState('')
  const [moveEntry, setMoveEntry] = useState<SSHFileEntry | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<SSHFileEntry | null>(null)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const dragDepth = useRef(0)
  const filterRef = useRef<HTMLInputElement | null>(null)

  const entries = listing?.entries ?? []
  const selectedIsFile = selected?.type === 'file' || selected?.type === 'symlink'
  const selectedCanDelete = !!selected && selected.path !== '/' && selected.path !== '.'
  const selectedCanMove = selectedCanDelete

  // ⌘R 刷新当前目录，⌘F 聚焦过滤框（blueprint §4.2）。
  useAppAction('refresh-view', active && !busy ? () => void loadFiles(currentPath) : null)
  useAppAction('focus-filter', active ? () => filterRef.current?.focus() : null)

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
    void loadFiles(pathDraft || '.')
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
      const dropped = await getDroppedUploadEntries(dataTransfer, api.system.getPathForFile)
      if (dropped.length === 0) {
        showToast(t('sshFiles.toast.dropUnsupported'), 'error')
        return
      }

      const result = await unwrap(api.ssh.uploadEntries({ connectionId, remoteDir, entries: dropped }))
      showToast(
        t('sshFiles.toast.uploadedItems', {
          count: dropped.length,
          path: result.remotePath ?? remoteDir
        }),
        'success'
      )
      await loadFiles(remoteDir)
    })

  const openInEditor = (entry: SSHFileEntry) => {
    setRightView({ kind: 'ssh-editor', connectionId, connectionName, path: entry.path })
  }

  const download = (entry: SSHFileEntry) =>
    void runAction(async () => {
      const result =
        entry.type === 'directory'
          ? await unwrap(api.ssh.downloadDirectory({ connectionId, remotePath: entry.path }))
          : await unwrap(api.ssh.downloadFile({ connectionId, remotePath: entry.path }))
      if (!result.canceled) {
        const key =
          entry.type === 'directory' ? 'sshFiles.toast.downloadedDirectory' : 'sshFiles.toast.downloaded'
        showToast(t(key, { path: result.localPath ?? '' }), 'success')
      }
    })

  const createFolder = (name: string) =>
    void runAction(async () => {
      await unwrap(api.ssh.createDirectory({ connectionId, remoteDir: currentPath, name }))
      setNewFolderOpen(false)
      showToast(t('sshFiles.toast.folderCreated', { name }), 'success')
      await loadFiles(currentPath)
    })

  const deleteEntry = (entry: SSHFileEntry) =>
    runAction(async () => {
      await unwrap(api.ssh.deleteFile({ connectionId, remotePath: entry.path, type: entry.type }))
      showToast(t('sshFiles.toast.deleted', { name: entry.name }), 'success')
      await loadFiles(currentPath)
    })

  const performMove = ({ entry, nextPath }: PendingMove) =>
    runAction(async () => {
      await unwrap(api.ssh.moveFile({ connectionId, remotePath: entry.path, nextPath }))
      moveSSHPathTabs(connectionId, entry.path, nextPath)
      setMoveEntry(null)
      setPendingMove(null)
      showToast(t('sshFiles.toast.moved', { path: nextPath }), 'success')
      await loadFiles(currentPath)
    })

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

    const move: PendingMove = { entry: moveEntry, nextPath: buildSSHRemotePath(directory, name) }
    // 移动会让已打开的编辑器指向新路径并重新载入，未保存的改动会丢。以前这是
    // 一个 `window.confirm`；现在是一个可主题化的确认框，取消 = 不移动。
    if (hasUnsavedSSHPathTabs(connectionId, move.entry.path)) {
      setPendingMove(move)
      return
    }
    void performMove(move)
  }

  const openEntry = (entry: SSHFileEntry) => {
    if (busy || loading) return
    setSelected(entry)
    if (entry.type === 'directory') {
      void loadFiles(entry.path)
      return
    }
    if (entry.type !== 'file' && entry.type !== 'symlink') return
    openInEditor(entry)
  }

  const goParent = () => {
    if (busy || loading) return
    if (!listing?.parentPath) return
    void loadFiles(listing.parentPath)
  }

  const entryMenuItems = (entry: SSHFileEntry): MenuItem[] => {
    const isFile = entry.type === 'file' || entry.type === 'symlink'
    const isRoot = entry.path === '/' || entry.path === '.'
    return [
      {
        id: 'open',
        icon: FilePen,
        label: t('sshFiles.openInEditor'),
        disabled: !isFile,
        disabledReason: t('sshFiles.onlyFiles'),
        onSelect: () => openInEditor(entry)
      },
      {
        id: 'download',
        icon: Download,
        label: entry.type === 'directory' ? t('sshFiles.downloadFolder') : t('sshFiles.download'),
        onSelect: () => download(entry)
      },
      {
        id: 'move',
        icon: PencilLine,
        label: t('sshFiles.move'),
        disabled: isRoot,
        disabledReason: t('sshFiles.rootProtected'),
        onSelect: () => setMoveEntry(entry)
      },
      { kind: 'separator', id: 'sep-1' },
      {
        id: 'delete',
        icon: Trash2,
        label: t('common.delete'),
        danger: true,
        disabled: isRoot,
        disabledReason: t('sshFiles.rootProtected'),
        onSelect: () => setPendingDelete(entry)
      }
    ]
  }

  const toolbarOverflow: MenuItem[] = [
    {
      id: 'open',
      icon: FilePen,
      label: t('sshFiles.openInEditor'),
      disabled: !selectedIsFile,
      disabledReason: selected ? t('sshFiles.onlyFiles') : t('sshFiles.selectFirst'),
      onSelect: () => selected && openInEditor(selected)
    },
    {
      id: 'move',
      icon: PencilLine,
      label: t('sshFiles.move'),
      disabled: !selectedCanMove,
      disabledReason: selected ? t('sshFiles.rootProtected') : t('sshFiles.selectFirst'),
      onSelect: () => selected && setMoveEntry(selected)
    },
    { kind: 'separator', id: 'sep-1' },
    {
      id: 'new-folder',
      icon: FolderPlus,
      label: t('sshFiles.newFolder'),
      onSelect: () => setNewFolderOpen(true)
    },
    {
      id: 'upload-folder',
      icon: FolderUp,
      label: t('sshFiles.uploadFolder'),
      disabled: loading || busy,
      disabledReason: t('common.loading'),
      onSelect: () => void uploadDirectory()
    },
    { kind: 'separator', id: 'sep-2' },
    {
      id: 'delete',
      icon: Trash2,
      label: t('common.delete'),
      danger: true,
      disabled: !selectedCanDelete,
      disabledReason: selected ? t('sshFiles.rootProtected') : t('sshFiles.selectFirst'),
      onSelect: () => selected && setPendingDelete(selected)
    }
  ]

  const visibleEntries = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return entries
    return entries.filter((entry) => entry.name.toLowerCase().includes(query))
  }, [entries, filter])

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
    if (dragDepth.current === 0) setDraggingUpload(false)
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
      className={cn('flex h-full min-h-0 flex-col overflow-hidden bg-canvas', draggingUpload && 'bg-selected')}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <SSHFileToolbar
        connectionName={connectionName}
        currentPath={currentPath}
        parentPath={listing?.parentPath}
        pathDraft={pathDraft}
        editingPath={editingPath}
        filter={filter}
        selected={selected}
        loading={loading}
        busy={busy}
        overflow={toolbarOverflow}
        filterRef={filterRef}
        onRefresh={() => void loadFiles(currentPath)}
        onUploadFile={() => void uploadFile()}
        onUploadDirectory={() => void uploadDirectory()}
        onDownload={download}
        onGoParent={goParent}
        onNavigate={(path) => void loadFiles(path)}
        onPathDraftChange={setPathDraft}
        onStartPathEdit={() => {
          setPathDraft(currentPath)
          setEditingPath(true)
        }}
        onCancelPathEdit={() => {
          setPathDraft(currentPath)
          setEditingPath(false)
        }}
        onSubmitPath={submitPath}
        onFilterChange={setFilter}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        <SSHFileTable
          entries={visibleEntries}
          selectedPath={selected?.path}
          filter={filter}
          loading={loading}
          hasListing={!!listing}
          loadError={loadError}
          onRetry={() => void loadFiles(currentPath)}
          onClearFilter={() => setFilter('')}
          onUploadFile={() => void uploadFile()}
          onNewFolder={() => setNewFolderOpen(true)}
          onSelect={setSelected}
          onActivate={openEntry}
          getEntryMenuItems={entryMenuItems}
        />
      </div>

      <div
        className={cn(
          'flex h-statusbar shrink-0 items-center border-t border-border px-2 text-2xs text-fg-muted',
          draggingUpload && 'bg-selected text-fg'
        )}
      >
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

      <SSHNewFolderDialog
        open={newFolderOpen}
        busy={busy}
        parentPath={currentPath}
        onOpenChange={setNewFolderOpen}
        onConfirm={createFolder}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        tone="danger"
        title={t('sshFiles.confirmDeleteTitle')}
        subject={pendingDelete?.path}
        body={t('sshFiles.confirmDeleteBody')}
        consequence={t('common.cannotBeUndone')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          const entry = pendingDelete
          setPendingDelete(null)
          if (entry) await deleteEntry(entry)
        }}
      />

      <ConfirmDialog
        open={!!pendingMove}
        onOpenChange={(open) => {
          if (!open) setPendingMove(null)
        }}
        tone="danger"
        title={t('sshFiles.confirmMoveUnsavedTitle')}
        subject={pendingMove?.entry.path}
        body={t('sshFiles.confirmMoveUnsavedBody')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('sshFiles.moveDialog.confirm')}
        onConfirm={async () => {
          const move = pendingMove
          setPendingMove(null)
          if (move) await performMove(move)
        }}
      />
    </div>
  )
}
