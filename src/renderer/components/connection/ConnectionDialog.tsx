// 新增 / 编辑连接的弹窗
import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { api, unwrap } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import type { ConnectionConfig, DbEngine, SafeConnection } from '../../../shared/types'
import { ConnectionDialogForm } from './ConnectionDialogForm'
import {
  buildPayload,
  createInitialForm,
  DEFAULT_PORT,
  DEFAULT_USERNAME,
  getInitialSSHAuthMethod,
  type SSHAuthMethod,
  validateConnectionForm
} from './connection-dialog-utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection?: SafeConnection | null
  sshSource?: SafeConnection | null
  onSaved?: () => void
}

// Blueprint §1.3 / §3.11: this dialog deliberately has NO Delete button. It used
// to sit in the footer beside Save, guarded only by a native `confirm()`. Delete
// is now reached from Settings ▸ Connections and from the connection row's `⋯`,
// and both route through `ConfirmDialog`. Do not re-add it here.
export function ConnectionDialog({ open, onOpenChange, connection, sshSource, onSaved }: Props) {
  const { showToast } = useUIStore()
  const { t } = useI18n()
  const sshKeyInputRef = useRef<HTMLInputElement>(null)
  const [testFeedback, setTestFeedback] = useState<{
    level: 'success' | 'error'
    message: string
  } | null>(null)
  const [draggingSSHKey, setDraggingSSHKey] = useState(false)
  const [form, setForm] = useState<ConnectionConfig>(createInitialForm(connection, sshSource))
  const [sshAuthMethod, setSSHAuthMethod] = useState<SSHAuthMethod>(
    getInitialSSHAuthMethod(connection || sshSource)
  )
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(createInitialForm(connection, sshSource))
    setSSHAuthMethod(getInitialSSHAuthMethod(connection || sshSource))
    setBusy(false)
    setDraggingSSHKey(false)
    setTestFeedback(null)
  }, [connection, open, sshSource])

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
          sshPrivateKeyPath: '',
          sshPassphrase: '',
          sshSourceConnectionId: undefined
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

  const updateSSHAuthMethod = (method: SSHAuthMethod) => {
    setTestFeedback(null)
    setSSHAuthMethod(method)
    setForm((current) => method === 'password'
      ? {
          ...current,
          sshPrivateKey: '',
          sshPrivateKeyPath: '',
          sshPassphrase: ''
        }
      : {
          ...current,
          sshPassword: ''
        })
  }

  const validationOptions = {
    hasSSHPassword: connection?.hasSSHPassword || sshSource?.hasSSHPassword,
    hasSSHPrivateKey: connection?.hasSSHPrivateKey || sshSource?.hasSSHPrivateKey,
    sshAuthMethod
  }

  const loadSSHKeyFile = async (file: File) => {
    try {
      const content = await file.text()
      const filePath = (file as File & { path?: string }).path?.trim() || file.name
      setTestFeedback(null)
      setForm((current) => ({
        ...current,
        sshPrivateKey: content,
        sshPrivateKeyPath: filePath
      }))
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
    const validationError = validateConnectionForm(form, validationOptions)
    if (validationError) {
      showToast(validationError, 'error')
      setTestFeedback({ level: 'error', message: validationError })
      return
    }

    setBusy(true)
    setTestFeedback(null)
    try {
      const result = await unwrap(api.connection.test(buildPayload(form, sshAuthMethod)))
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
    const validationError = validateConnectionForm(form, validationOptions)
    if (validationError) {
      showToast(validationError, 'error')
      return
    }

    setBusy(true)
    try {
      await unwrap(api.connection.upsert(buildPayload(form, sshAuthMethod)))
      showToast(t('common.saved'), 'success')
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      showToast((err as Error).message, 'error')
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
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onTest} disabled={busy}>
            {t('common.test')}
          </Button>
          <Button variant="primary" onClick={onSave} disabled={busy}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <ConnectionDialogForm
        connection={connection}
        form={form}
        sshAuthMethod={sshAuthMethod}
        draggingSSHKey={draggingSSHKey}
        onChange={update}
        onSSHAuthMethodChange={updateSSHAuthMethod}
        onSSHKeyInputChange={onSSHKeyInputChange}
        onSSHKeyDrop={onSSHKeyDrop}
        onSSHKeyDraggingChange={setDraggingSSHKey}
        sshKeyInputRef={sshKeyInputRef}
      />
      {sshSource && (
        <div className="mt-4 rounded-md border border-border bg-surface-2/40 px-3 py-2 text-sm text-fg-muted">
          {t('connection.reusingSsh', { name: sshSource.name })}
        </div>
      )}
      {testFeedback && (
        <div
          role="status"
          className={cn(
            'mt-4 rounded-md border px-3 py-2 text-sm',
            testFeedback.level === 'error'
              ? 'border-danger/30 bg-danger-quiet text-danger-text'
              : 'border-success/30 bg-success-quiet text-success-text'
          )}
        >
          {testFeedback.message}
        </div>
      )}
    </Dialog>
  )
}
