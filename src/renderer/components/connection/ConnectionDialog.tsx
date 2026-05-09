// 新增 / 编辑连接的弹窗
import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { api, unwrap } from '@renderer/lib/api'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import type { ConnectionConfig, DbEngine, SafeConnection } from '../../../shared/types'
import { ConnectionDialogForm } from './ConnectionDialogForm'
import {
  buildPayload,
  createInitialForm,
  DEFAULT_PORT,
  DEFAULT_USERNAME,
  validateConnectionForm
} from './connection-dialog-utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection?: SafeConnection | null
  onSaved?: () => void
  onDelete?: (connection: SafeConnection) => boolean | Promise<boolean>
}

export function ConnectionDialog({ open, onOpenChange, connection, onSaved, onDelete }: Props) {
  const { showToast } = useUIStore()
  const { t } = useI18n()
  const sshKeyInputRef = useRef<HTMLInputElement>(null)
  const [testFeedback, setTestFeedback] = useState<{
    level: 'success' | 'error'
    message: string
  } | null>(null)
  const [draggingSSHKey, setDraggingSSHKey] = useState(false)
  const [form, setForm] = useState<ConnectionConfig>(createInitialForm(connection))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(createInitialForm(connection))
    setBusy(false)
    setDraggingSSHKey(false)
    setTestFeedback(null)
  }, [connection, open])

  const update = <K extends keyof ConnectionConfig>(key: K, value: ConnectionConfig[K]) => {
    setTestFeedback(null)
    setForm((current) => {
      if (key === 'useSSH' && !value) {
        return {
          ...current,
          useSSH: false,
          sshHost: '',
          sshPort: 22,
          sshUsername: '',
          sshPassword: '',
          sshPrivateKey: '',
          sshPassphrase: ''
        }
      }
      if (key === 'engine') {
        const nextEngine = value as DbEngine
        const previousDefault = DEFAULT_PORT[current.engine]
        // 切换引擎时，若当前端口还是上一引擎默认值，同步切换为新默认值
        const nextPort = current.port === previousDefault ? DEFAULT_PORT[nextEngine] : current.port
        const nextUsername = current.username === DEFAULT_USERNAME[current.engine]
          ? DEFAULT_USERNAME[nextEngine]
          : current.username
        return { ...current, engine: nextEngine, port: nextPort, username: nextUsername }
      }
      return { ...current, [key]: value }
    })
  }

  const loadSSHKeyFile = async (file: File) => {
    try {
      const content = await file.text()
      update('sshPrivateKey', content)
      showToast(t('connection.sshKeyLoaded', { name: file.name }), 'success')
    } catch {
      showToast(t('connection.sshKeyReadFailed'), 'error')
    }
  }

  const onSSHKeyInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await loadSSHKeyFile(file)
    e.target.value = ''
  }

  const onSSHKeyDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDraggingSSHKey(false)
    const file = e.dataTransfer.files?.[0]
    if (file) await loadSSHKeyFile(file)
  }

  const onTest = async () => {
    const validationError = validateConnectionForm(form)
    if (validationError) {
      showToast(validationError, 'error')
      setTestFeedback({ level: 'error', message: validationError })
      return
    }

    setBusy(true)
    setTestFeedback(null)
    try {
      const result = await unwrap(api.connection.test(buildPayload(form)))
      setTestFeedback({ level: 'success', message: result.message })
      showToast(result.message, 'success')
    } catch (err) {
      const message = (err as Error).message
      setTestFeedback({ level: 'error', message })
      showToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const onSave = async () => {
    const validationError = validateConnectionForm(form)
    if (validationError) {
      showToast(validationError, 'error')
      return
    }

    setBusy(true)
    try {
      await unwrap(api.connection.upsert(buildPayload(form)))
      showToast(t('common.saved'), 'success')
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const onDeleteClick = async () => {
    if (!connection || !onDelete) return
    setBusy(true)
    try {
      const deleted = await onDelete(connection)
      if (deleted) onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={connection ? t('connection.editTitle') : t('connection.newTitle')}
      description={t('connection.description')}
      className="max-w-2xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div>
            {connection && onDelete && (
              <Button variant="destructive" onClick={onDeleteClick} disabled={busy}>
                {t('common.delete')}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onTest} disabled={busy}>
              {t('common.test')}
            </Button>
            <Button onClick={onSave} disabled={busy}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <ConnectionDialogForm
        connection={connection}
        form={form}
        draggingSSHKey={draggingSSHKey}
        onChange={update}
        onSSHKeyInputChange={onSSHKeyInputChange}
        onSSHKeyDrop={onSSHKeyDrop}
        onSSHKeyDraggingChange={setDraggingSSHKey}
        sshKeyInputRef={sshKeyInputRef}
      />
      {testFeedback && (
        <div
          className={
            testFeedback.level === 'error'
              ? 'mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300'
              : 'mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300'
          }
        >
          {testFeedback.message}
        </div>
      )}
    </Dialog>
  )
}
