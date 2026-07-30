import { useMemo } from 'react'
import { EllipsisVertical, File, Folder, FolderPlus, RefreshCw, Upload } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { DataTable, type Column } from '@renderer/components/ui/data-table'
import { DropdownMenu, type MenuItem } from '@renderer/components/ui/dropdown-menu'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { IconButton } from '@renderer/components/ui/icon-button'
import { formatBytes, formatDateTime } from '@renderer/lib/format'
import { useI18n } from '@renderer/i18n'
import type { SSHFileEntry } from '../../../shared/types'

interface SSHFileTableProps {
  entries: SSHFileEntry[]
  selectedPath?: string
  filter: string
  loading: boolean
  hasListing: boolean
  loadError: Error | null
  onRetry: () => void
  onClearFilter: () => void
  onUploadFile: () => void
  onNewFolder: () => void
  onSelect: (entry: SSHFileEntry) => void
  onActivate: (entry: SSHFileEntry) => void
  getEntryMenuItems: (entry: SSHFileEntry) => MenuItem[]
}

export function SSHFileTable({
  entries,
  selectedPath,
  filter,
  loading,
  hasListing,
  loadError,
  onRetry,
  onClearFilter,
  onUploadFile,
  onNewFolder,
  onSelect,
  onActivate,
  getEntryMenuItems
}: SSHFileTableProps) {
  const { t } = useI18n()

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
            items={getEntryMenuItems(entry)}
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
    [getEntryMenuItems, t]
  )

  if (loadError && !hasListing) {
    return (
      <div className="p-3">
        <EmptyState
          variant="error"
          title={t('sshFiles.loadFailed')}
          description={loadError.message}
          error={loadError}
          detailsLabel={t('common.details')}
          action={
            <Button variant="primary" icon={RefreshCw} onClick={onRetry}>
              {t('common.retry')}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <DataTable<SSHFileEntry>
      aria-label={t('sshFiles.title')}
      columns={columns}
      rows={entries}
      rowKey={(entry) => entry.path}
      loading={loading && !hasListing}
      onRowClick={onSelect}
      onRowActivate={onActivate}
      activateOn="double-click"
      onRowContextMenu={getEntryMenuItems}
      rowClassName={(entry) => (selectedPath === entry.path ? 'bg-selected' : undefined)}
      empty={
        filter.trim() ? (
          <EmptyState
            size="sm"
            variant="no-results"
            title={t('sshFiles.noMatches')}
            action={
              <Button size="sm" variant="secondary" onClick={onClearFilter}>
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
              <Button size="sm" variant="primary" icon={Upload} onClick={onUploadFile}>
                {t('sshFiles.uploadFile')}
              </Button>
            }
            secondaryAction={
              <Button size="sm" variant="secondary" icon={FolderPlus} onClick={onNewFolder}>
                {t('sshFiles.newFolder')}
              </Button>
            }
          />
        )
      }
    />
  )
}
