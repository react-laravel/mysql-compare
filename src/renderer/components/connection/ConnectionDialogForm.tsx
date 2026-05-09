import type { ChangeEvent, DragEvent, ReactNode, RefObject } from 'react'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { useI18n } from '@renderer/i18n'
import type { ConnectionConfig, DbEngine, SafeConnection } from '../../../shared/types'
import { DEFAULT_PORT, parsePortValue } from './connection-dialog-utils'

interface Props {
  connection?: SafeConnection | null
  form: ConnectionConfig
  draggingSSHKey: boolean
  onChange: <K extends keyof ConnectionConfig>(key: K, value: ConnectionConfig[K]) => void
  onSSHKeyInputChange: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>
  onSSHKeyDrop: (event: DragEvent<HTMLDivElement>) => void | Promise<void>
  onSSHKeyDraggingChange: (dragging: boolean) => void
  sshKeyInputRef: RefObject<HTMLInputElement>
}

export function ConnectionDialogForm({
  connection,
  form,
  draggingSSHKey,
  onChange,
  onSSHKeyInputChange,
  onSSHKeyDrop,
  onSSHKeyDraggingChange,
  sshKeyInputRef
}: Props) {
  const { t } = useI18n()
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t('connection.form.engine')}>
        <select
          value={form.engine}
          onChange={(event) => onChange('engine', event.target.value as DbEngine)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="mysql">{t('connection.form.mysql')}</option>
          <option value="postgres">{t('connection.form.postgres')}</option>
          <option value="redis">{t('connection.form.redis')}</option>
        </select>
      </Field>
      <Field label={t('common.name')}>
        <Input value={form.name} onChange={(event) => onChange('name', event.target.value)} />
      </Field>
      <Field label={t('connection.form.group')}>
        <Input value={form.group || ''} onChange={(event) => onChange('group', event.target.value)} />
      </Field>
      <div />
      <Field label={t('connection.form.host')}>
        <Input value={form.host} onChange={(event) => onChange('host', event.target.value)} />
      </Field>
      <Field label={t('connection.form.port')}>
        <Input
          type="number"
          min={1}
          max={65535}
          value={form.port}
          onChange={(event) =>
            onChange('port', parsePortValue(event.target.value, DEFAULT_PORT[form.engine]))
          }
        />
      </Field>
      <Field label={t('connection.form.username')}>
        <Input value={form.username} onChange={(event) => onChange('username', event.target.value)} />
      </Field>
      <Field label={connection?.hasPassword ? t('connection.form.passwordKeep') : t('connection.form.password')}>
        <Input
          type="password"
          value={form.password || ''}
          onChange={(event) => onChange('password', event.target.value)}
        />
      </Field>
      <Field label={t('connection.form.defaultDatabase')}>
        <Input
          value={form.database || ''}
          onChange={(event) => onChange('database', event.target.value)}
        />
      </Field>
      <div />

      <div className="col-span-2 mt-2 flex items-center gap-2">
        <Checkbox
          checked={form.useSSH}
          onChange={(event) => onChange('useSSH', event.target.checked)}
          id="useSSH"
        />
        <label htmlFor="useSSH" className="text-sm">
          {t('connection.form.useSshTunnel')}
        </label>
      </div>

      {form.useSSH && (
        <>
          <Field label={t('connection.form.sshHost')}>
            <Input
              value={form.sshHost || ''}
              onChange={(event) => onChange('sshHost', event.target.value)}
            />
          </Field>
          <Field label={t('connection.form.sshPort')}>
            <Input
              type="number"
              min={1}
              max={65535}
              value={form.sshPort || 22}
              onChange={(event) => onChange('sshPort', parsePortValue(event.target.value, 22))}
            />
          </Field>
          <Field label={t('connection.form.sshUsername')}>
            <Input
              value={form.sshUsername || ''}
              onChange={(event) => onChange('sshUsername', event.target.value)}
            />
          </Field>
          <Field label={connection?.hasSSHPassword ? t('connection.form.sshPasswordKeep') : t('connection.form.sshPassword')}>
            <Input
              type="password"
              value={form.sshPassword || ''}
              onChange={(event) => onChange('sshPassword', event.target.value)}
            />
          </Field>
          <Field
            label={connection?.hasSSHPrivateKey ? t('connection.form.sshPrivateKeyKeep') : t('connection.form.sshPrivateKey')}
            className="col-span-2"
          >
            <input
              ref={sshKeyInputRef}
              type="file"
              className="hidden"
              onChange={onSSHKeyInputChange}
            />
            <div
              className={
                draggingSSHKey
                  ? 'mb-2 rounded-md border border-primary bg-primary/10 px-3 py-2 text-sm text-primary'
                  : 'mb-2 rounded-md border border-dashed border-input bg-background/60 px-3 py-2 text-sm text-muted-foreground'
              }
              onDragOver={(event) => event.preventDefault()}
              onDragEnter={(event) => {
                event.preventDefault()
                onSSHKeyDraggingChange(true)
              }}
              onDragLeave={(event) => {
                event.preventDefault()
                onSSHKeyDraggingChange(false)
              }}
              onDrop={onSSHKeyDrop}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{t('connection.form.dropKeyHint')}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => sshKeyInputRef.current?.click()}
                >
                  {t('connection.form.chooseFile')}
                </Button>
              </div>
            </div>
            <textarea
              value={form.sshPrivateKey || ''}
              onChange={(event) => onChange('sshPrivateKey', event.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              rows={4}
              className="w-full rounded-md border border-input bg-background p-2 text-xs font-mono"
            />
          </Field>
          <Field label={t('connection.form.keyPassphrase')}>
            <Input
              type="password"
              value={form.sshPassphrase || ''}
              onChange={(event) => onChange('sshPassphrase', event.target.value)}
            />
          </Field>
        </>
      )}
    </div>
  )
}

function Field({
  label,
  children,
  className
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <Label className="mb-1 block">{label}</Label>
      {children}
    </div>
  )
}