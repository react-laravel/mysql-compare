// SFTP 文件管理（blueprint §3.7）。
//
// 旧版把 7 个平铺按钮塞在一行，全部只作用于"当前选中行"，而选中只有一个淡色
// 背景在提示。现在是：`Toolbar`（Refresh · Upload ▾ · Download · ⋯）+ 面包屑/
// 过滤行 + `DataTable`，每一行常驻一个 `⋯`，所以动作和对象在同一处。
// 删除走 `ConfirmDialog`，不再是 `window.confirm`。
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Check,
  Download,
  EllipsisVertical,
  File,
  FilePen,
  Folder,
  FolderPlus,
  FolderUp,
  PencilLine,
  RefreshCw,
  Trash2,
  Upload
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { DataTable, type Column } from '@renderer/components/ui/data-table'
import { DropdownMenu, type MenuItem } from '@renderer/components/ui/dropdown-menu'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Input } from '@renderer/components/ui/input'
import { SearchInput } from '@renderer/components/ui/search-input'
import { SplitButton } from '@renderer/components/ui/split-button'
import { Toolbar } from '@renderer/components/ui/toolbar'
import { api, unwrap } from '@renderer/lib/api'
import { useAppAction } from '@renderer/lib/app-actions'
import { formatBytes, formatDateTime } from '@renderer/lib/format'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import { useUIStore } from '@renderer/store/ui-store'
import { SSHMoveDialog } from './SSHMoveDialog'
import { SSHNewFolderDialog } from './SSHNewFolderDialog'
import { getDroppedUploadEntries } from './ssh-drop-utils'
import type { SSHFileEntry, SSHListFilesResult } from '../../../shared/types'

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
  const [currentPath, setCurrentPath] = useState('.')
  const [pathDraft, setPathDraft] = useState('.')
  const [editingPath, setEditingPath] = useState(false)
  const [listing, setListing] = useState<SSHListFilesResult | null>(null)
  const [selected, setSelected] = useState<SSHFileEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draggingUpload, setDraggingUpload] = useState(false)
  const [filter, setFilter] = useState('')
  const [moveEntry, setMoveEntry] = useState<SSHFileEntry | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<SSHFileEntry | null>(null)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const dragDepth = useRef(0)
  const requestSeq = useRef(0)
  const filterRef = useRef<HTMLInputElement | null>(null)

  const entries = listing?.entries ?? []
  const selectedIsFile = selected?.type === 'file' || selected?.type === 'symlink'
  const selectedCanDelete = !!selected && selected.path !== '/' && selected.path !== '.'
  const selectedCanMove = selectedCanDelete

  const loadFiles = async (path = currentPath) => {
    const requestId = requestSeq.current + 1
    requestSeq.current = requestId
    setLoading(true)
    try {
      const result = await unwrap(api.ssh.listFiles({ connectionId, path }))
      if (requestSeq.current !== requestId) return
      setListing(result)
      setLoadError(null)
      setCurrentPath(result.path)
      setPathDraft(result.path)
      setEditingPath(false)
      setSelected(null)
    } catch (error) {
      if (requestSeq.current !== requestId) return
      setLoadError(error as Error)
      showToast((error as Error).message, 'error')
    } finally {
      if (requestSeq.current === requestId) setLoading(false)
    }
  }

  useEffect(() => {
    void loadFiles('.')
  }, [connectionId])

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

    const move: PendingMove = { entry: moveEntry, nextPath: buildRemotePath(directory, name) }
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

  const columns = useMemo<Column<SSHFileEntry>[]>(
    () => [
      {
        id: 'name',
        header: t('common.name'),
        cell: (entry) => (
          <span className="flex min-w-0 items-center gap-2">
            {entry.type === 'directory' ? (
              <Folder aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-accent-text" />
            ) : (
              <File aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-fg-muted" />
            )}
            <span className="truncate font-mono">{entry.name}</span>
          </span>
        ),
        title: (entry) => entry.path
      },
      { id: 'type', header: t('common.type'), width: 96, cell: (entry) => t(`sshFiles.type.${entry.type}`) },
      {
        id: 'size',
        header: t('sshFiles.size'),
        width: 104,
        align: 'right',
        cell: (entry) => (entry.type === 'directory' ? '—' : formatBytes(entry.size))
      },
      {
        id: 'permissions',
        header: t('sshFiles.permissions'),
        width: 120,
        mono: true,
        cell: (entry) => entry.permissions
      },
      {
        id: 'modified',
        header: t('sshFiles.modifiedAt'),
        width: 168,
        cell: (entry) => formatDateTime(entry.modifiedAt)
      },
      {
        id: 'actions',
        header: <span className="sr-only">{t('common.action')}</span>,
        width: 44,
        align: 'right',
        cell: (entry) => (
          <DropdownMenu
            items={entryMenuItems(entry)}
            side="bottom"
            align="end"
            aria-label={t('common.moreActions')}
            trigger={
              <IconButton
                icon={EllipsisVertical}
                label={t('common.moreActions')}
                size="xs"
                variant="ghost"
                tooltipSide="left"
              />
            }
          />
        )
      }
    ],
    // 菜单闭包依赖当前目录与忙碌态，交给 React 每次渲染重建即可。
    [t, currentPath, busy, loading]
  )

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
      <Toolbar
        icon={Folder}
        title={connectionName}
        subtitle={<span className="font-mono">{currentPath}</span>}
        progress={loading || busy ? { status: 'running', label: t('common.loading') } : null}
        overflowLabel={t('common.moreActions')}
        overflow={toolbarOverflow}
        actions={
          <>
            <IconButton
              icon={RefreshCw}
              label={t('common.refresh')}
              shortcut="Mod+R"
              size="sm"
              variant="ghost"
              loading={loading}
              disabled={loading || busy}
              onClick={() => void loadFiles(currentPath)}
            />
            <SplitButton
              size="sm"
              variant="secondary"
              icon={Upload}
              disabled={loading || busy}
              onClick={() => void uploadFile()}
              menuLabel={t('sshFiles.uploadOptions')}
              items={[
                {
                  id: 'upload-folder',
                  icon: FolderUp,
                  label: t('sshFiles.uploadFolder'),
                  onSelect: () => void uploadDirectory()
                }
              ]}
            >
              {t('sshFiles.uploadFile')}
            </SplitButton>
            <Button
              size="sm"
              variant="secondary"
              icon={Download}
              disabled={loading || busy || !selected}
              onClick={() => selected && download(selected)}
            >
              {t('sshFiles.download')}
            </Button>
          </>
        }
        filters={
          <>
            <IconButton
              icon={ArrowUp}
              label={t('sshFiles.goParent')}
              size="xs"
              variant="ghost"
              onClick={goParent}
              disabled={!listing?.parentPath || loading || busy}
            />
            {editingPath ? (
              <>
                <Input
                  autoFocus
                  size="sm"
                  mono
                  aria-label={t('sshFiles.pathLabel')}
                  value={pathDraft}
                  onChange={(event) => setPathDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submitPath()
                    if (event.key === 'Escape') {
                      event.stopPropagation()
                      setPathDraft(currentPath)
                      setEditingPath(false)
                    }
                  }}
                  className="min-w-[12rem] flex-[1_1_20rem]"
                />
                <IconButton
                  icon={Check}
                  label={t('common.apply')}
                  size="xs"
                  variant="ghost"
                  disabled={loading || busy}
                  onClick={submitPath}
                />
              </>
            ) : (
              <>
                <nav aria-label={t('sshFiles.pathLabel')} className="flex min-w-0 flex-wrap items-center">
                  {breadcrumbSegments(currentPath).map((segment, index, all) => (
                    <span key={segment.path} className="flex items-center">
                      {index > 0 ? <span className="px-0.5 text-fg-subtle">/</span> : null}
                      <Button
                        size="xs"
                        variant="ghost"
                        className="font-mono"
                        aria-current={index === all.length - 1 ? 'page' : undefined}
                        disabled={loading || busy}
                        onClick={() => void loadFiles(segment.path)}
                      >
                        {segment.label}
                      </Button>
                    </span>
                  ))}
                </nav>
                <IconButton
                  icon={PencilLine}
                  label={t('sshFiles.editPath')}
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setPathDraft(currentPath)
                    setEditingPath(true)
                  }}
                />
              </>
            )}
            <SearchInput
              ref={filterRef}
              size="sm"
              value={filter}
              onValueChange={setFilter}
              placeholder={t('sshFiles.filterPlaceholder')}
              clearLabel={t('common.clear')}
              containerClassName="ml-auto w-56 shrink-0"
            />
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {loadError && !listing ? (
          <div className="p-3">
            <EmptyState
              variant="error"
              title={t('sshFiles.loadFailed')}
              description={loadError.message}
              error={loadError}
              detailsLabel={t('common.details')}
              action={
                <Button variant="primary" icon={RefreshCw} onClick={() => void loadFiles(currentPath)}>
                  {t('common.retry')}
                </Button>
              }
            />
          </div>
        ) : (
          <DataTable<SSHFileEntry>
            aria-label={t('sshFiles.title')}
            columns={columns}
            rows={visibleEntries}
            rowKey={(entry) => entry.path}
            loading={loading && !listing}
            onRowClick={(entry) => setSelected(entry)}
            onRowActivate={openEntry}
            activateOn="double-click"
            onRowContextMenu={entryMenuItems}
            rowClassName={(entry) => (selected?.path === entry.path ? 'bg-selected' : undefined)}
            empty={
              filter.trim() ? (
                <EmptyState
                  size="sm"
                  variant="no-results"
                  title={t('sshFiles.noMatches')}
                  action={
                    <Button size="sm" variant="secondary" onClick={() => setFilter('')}>
                      {t('common.clear')}
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  size="sm"
                  variant="first-run"
                  icon={Folder}
                  title={t('sshFiles.empty')}
                  action={
                    <Button size="sm" variant="primary" icon={Upload} onClick={() => void uploadFile()}>
                      {t('sshFiles.uploadFile')}
                    </Button>
                  }
                  secondaryAction={
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={FolderPlus}
                      onClick={() => setNewFolderOpen(true)}
                    >
                      {t('sshFiles.newFolder')}
                    </Button>
                  }
                />
              )
            }
          />
        )}
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

/** `/var/www/app` → `[/, var, www, app]`，每一段都能点回去。 */
function breadcrumbSegments(path: string): { label: string; path: string }[] {
  if (path === '.' || path === '') return [{ label: '.', path: '.' }]
  const parts = path.split('/').filter(Boolean)
  const absolute = path.startsWith('/')
  const segments = absolute ? [{ label: '/', path: '/' }] : []
  let prefix = absolute ? '' : '.'

  for (const part of parts) {
    prefix = prefix === '.' ? part : `${prefix}/${part}`
    segments.push({ label: part, path: prefix })
  }

  return segments
}

function buildRemotePath(directory: string, name: string): string {
  if (directory === '/') return `/${name}`
  if (directory === '.') return name
  return directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`
}

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).includes('Files')
}
