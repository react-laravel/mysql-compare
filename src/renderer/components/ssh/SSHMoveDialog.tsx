import { useEffect, useMemo, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { useI18n } from '@renderer/i18n'
import type { SSHFileEntry } from '../../../shared/types'

interface SSHMoveDialogProps {
  entry: SSHFileEntry | null
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (value: { directory: string; name: string }) => void
}

export function SSHMoveDialog({ entry, open, busy, onOpenChange, onConfirm }: SSHMoveDialogProps) {
  const { t } = useI18n()
  const [directory, setDirectory] = useState('.')
  const [name, setName] = useState('')

  useEffect(() => {
    if (!open || !entry) return
    setDirectory(getParentRemotePath(entry.path))
    setName(entry.name)
  }, [entry, open])

  const previewPath = useMemo(() => buildRemotePath(directory, name), [directory, name])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('sshFiles.moveDialog.title')}
      description={entry ? t('sshFiles.moveDialog.description', { name: entry.name }) : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => onConfirm({ directory, name })} disabled={busy || !entry}>
            {t('sshFiles.moveDialog.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('sshFiles.moveDialog.destinationFolder')}>
          <Input mono value={directory} onChange={(event) => setDirectory(event.target.value)} />
        </Field>
        <Field label={t('sshFiles.moveDialog.name')}>
          <Input mono value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="rounded-md border border-border bg-inset px-3 py-2 text-xs text-fg-muted">
          <div>{t('sshFiles.moveDialog.preview')}</div>
          <div className="mt-1 break-all font-mono text-fg">{previewPath}</div>
        </div>
      </div>
    </Dialog>
  )
}

function getParentRemotePath(path: string): string {
  if (path === '/' || path === '.') return path
  const normalized = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path
  const index = normalized.lastIndexOf('/')
  if (index < 0) return '.'
  if (index === 0) return '/'
  return normalized.slice(0, index)
}

function buildRemotePath(directory: string, name: string): string {
  if (!directory) return name
  if (directory === '/') return `/${name}`
  if (directory === '.') return name
  return directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`
}