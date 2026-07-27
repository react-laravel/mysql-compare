// "New folder…" 从常驻输入框搬进了工具栏 `⋯`（blueprint §3.7），所以它需要
// 一个自己的对话框 —— 走的是已加固的 `Dialog`（焦点陷阱 / aria-modal / size）。
import { useEffect, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { useI18n } from '@renderer/i18n'

interface SSHNewFolderDialogProps {
  open: boolean
  busy: boolean
  parentPath: string
  onOpenChange: (open: boolean) => void
  onConfirm: (name: string) => void
}

export function SSHNewFolderDialog({
  open,
  busy,
  parentPath,
  onOpenChange,
  onConfirm
}: SSHNewFolderDialogProps) {
  const { t } = useI18n()
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) setName('')
  }, [open])

  const trimmed = name.trim()
  const submit = () => {
    if (!trimmed || busy) return
    onConfirm(trimmed)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('sshFiles.newFolder')}
      description={t('sshFiles.newFolderDescription', { path: parentPath })}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={busy || !trimmed} onClick={submit}>
            {t('sshFiles.createFolder')}
          </Button>
        </>
      }
    >
      <Field label={t('common.name')}>
        <Input
          autoFocus
          mono
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          placeholder={t('sshFiles.newFolderPlaceholder')}
        />
      </Field>
    </Dialog>
  )
}
