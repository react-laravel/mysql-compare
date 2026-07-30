import type { RefObject } from 'react'
import {
  ArrowUp,
  Check,
  Download,
  Folder,
  FolderUp,
  PencilLine,
  RefreshCw,
  Upload
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Input } from '@renderer/components/ui/input'
import { SearchInput } from '@renderer/components/ui/search-input'
import { SplitButton } from '@renderer/components/ui/split-button'
import { Toolbar } from '@renderer/components/ui/toolbar'
import type { MenuItem } from '@renderer/components/ui/dropdown-menu'
import { useI18n } from '@renderer/i18n'
import type { SSHFileEntry } from '../../../shared/types'
import { getSSHBreadcrumbSegments } from './ssh-file-path'

interface SSHFileToolbarProps {
  connectionName: string
  currentPath: string
  parentPath?: string | null
  pathDraft: string
  editingPath: boolean
  filter: string
  selected: SSHFileEntry | null
  loading: boolean
  busy: boolean
  overflow: MenuItem[]
  filterRef: RefObject<HTMLInputElement | null>
  onRefresh: () => void
  onUploadFile: () => void
  onUploadDirectory: () => void
  onDownload: (entry: SSHFileEntry) => void
  onGoParent: () => void
  onNavigate: (path: string) => void
  onPathDraftChange: (path: string) => void
  onStartPathEdit: () => void
  onCancelPathEdit: () => void
  onSubmitPath: () => void
  onFilterChange: (filter: string) => void
}

export function SSHFileToolbar({
  connectionName,
  currentPath,
  parentPath,
  pathDraft,
  editingPath,
  filter,
  selected,
  loading,
  busy,
  overflow,
  filterRef,
  onRefresh,
  onUploadFile,
  onUploadDirectory,
  onDownload,
  onGoParent,
  onNavigate,
  onPathDraftChange,
  onStartPathEdit,
  onCancelPathEdit,
  onSubmitPath,
  onFilterChange
}: SSHFileToolbarProps) {
  const { t } = useI18n()
  const disabled = loading || busy

  return (
    <Toolbar
      icon={Folder}
      title={connectionName}
      subtitle={<span className="font-mono">{currentPath}</span>}
      progress={disabled ? { status: 'running', label: t('common.loading') } : null}
      overflowLabel={t('common.moreActions')}
      overflow={overflow}
      actions={
        <>
          <IconButton
            icon={RefreshCw}
            label={t('common.refresh')}
            shortcut="Mod+R"
            size="sm"
            variant="ghost"
            loading={loading}
            disabled={disabled}
            onClick={onRefresh}
          />
          <SplitButton
            size="sm"
            variant="secondary"
            icon={Upload}
            disabled={disabled}
            onClick={onUploadFile}
            menuLabel={t('sshFiles.uploadOptions')}
            items={[
              {
                id: 'upload-folder',
                icon: FolderUp,
                label: t('sshFiles.uploadFolder'),
                onSelect: onUploadDirectory
              }
            ]}
          >
            {t('sshFiles.uploadFile')}
          </SplitButton>
          <Button
            size="sm"
            variant="secondary"
            icon={Download}
            disabled={disabled || !selected}
            onClick={() => selected && onDownload(selected)}
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
            onClick={onGoParent}
            disabled={!parentPath || disabled}
          />
          {editingPath ? (
            <>
              <Input
                autoFocus
                size="sm"
                mono
                aria-label={t('sshFiles.pathLabel')}
                value={pathDraft}
                onChange={(event) => onPathDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSubmitPath()
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    onCancelPathEdit()
                  }
                }}
                className="min-w-[12rem] flex-[1_1_20rem]"
              />
              <IconButton
                icon={Check}
                label={t('common.apply')}
                size="xs"
                variant="ghost"
                disabled={disabled}
                onClick={onSubmitPath}
              />
            </>
          ) : (
            <>
              <nav aria-label={t('sshFiles.pathLabel')} className="flex min-w-0 flex-wrap items-center">
                {getSSHBreadcrumbSegments(currentPath).map((segment, index, all) => (
                  <span key={segment.path} className="flex items-center">
                    {index > 0 ? <span className="px-0.5 text-fg-subtle">/</span> : null}
                    <Button
                      size="xs"
                      variant="ghost"
                      className="font-mono"
                      aria-current={index === all.length - 1 ? 'page' : undefined}
                      disabled={disabled}
                      onClick={() => onNavigate(segment.path)}
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
                onClick={onStartPathEdit}
              />
            </>
          )}
          <SearchInput
            ref={filterRef}
            size="sm"
            value={filter}
            onValueChange={onFilterChange}
            placeholder={t('sshFiles.filterPlaceholder')}
            clearLabel={t('common.clear')}
            containerClassName="ml-auto w-56 shrink-0"
          />
        </>
      }
    />
  )
}
