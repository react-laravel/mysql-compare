import type { ChangeEvent, DragEvent, ReactNode, RefObject } from 'react'
import { Input, Textarea } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { EngineIcon } from '@renderer/components/icons/EngineIcon'
import { useI18n } from '@renderer/i18n'
import { cn } from '@renderer/lib/utils'
import type { ConnectionConfig, DbEngine, SafeConnection } from '../../../shared/types'
import {
  DEFAULT_PORT,
  parsePortValue,
  type SSHAuthMethod
} from './connection-dialog-utils'

interface Props {
  connection?: SafeConnection | null
  form: ConnectionConfig
  sshAuthMethod: SSHAuthMethod
  draggingSSHKey: boolean
  onChange: <K extends keyof ConnectionConfig>(key: K, value: ConnectionConfig[K]) => void
  onSSHAuthMethodChange: (method: SSHAuthMethod) => void
  onSSHKeyInputChange: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>
  onSSHKeyDrop: (event: DragEvent<HTMLDivElement>) => void | Promise<void>
  onSSHKeyDraggingChange: (dragging: boolean) => void
  sshKeyInputRef: RefObject<HTMLInputElement | null>
}

export function ConnectionDialogForm({
  connection,
  form,
  sshAuthMethod,
  draggingSSHKey,
  onChange,
  onSSHAuthMethodChange,
  onSSHKeyInputChange,
  onSSHKeyDrop,
  onSSHKeyDraggingChange,
  sshKeyInputRef
}: Props) {
  const { t } = useI18n()
  const engineOptions: { value: DbEngine; label: string }[] = [
    { value: 'mysql', label: t('connection.form.mysql') },
    { value: 'postgres', label: t('connection.form.postgres') },
    { value: 'redis', label: t('connection.form.redis') }
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t('connection.form.engine')} className="col-span-2">
        <div
          role="radiogroup"
          aria-label={t('connection.form.engine')}
          className="grid grid-cols-3 gap-2"
        >
          {engineOptions.map((option) => {
            const selected = form.engine === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange('engine', option.value)}
                className={cn(
                  'flex h-12 items-center gap-3 rounded-md border border-border bg-canvas px-3 text-left text-sm transition-colors hover:bg-hover',
                  selected && 'border-accent bg-accent/10 ring-1 ring-accent'
                )}
              >
                <EngineIcon engine={option.value} className="h-6 w-6 shrink-0" />
                <span className="font-medium">{option.label}</span>
              </button>
            )
          })}
        </div>
      </Field>
      <Field label={t('common.name')}>
        <Input
          value={form.name}
          placeholder={t('connection.form.namePlaceholder')}
          onChange={(event) => onChange('name', event.target.value)}
        />
      </Field>
      <Field label={t('connection.form.group')}>
        <Input value={form.group || ''} onChange={(event) => onChange('group', event.target.value)} />
      </Field>
      <Field label={t('connection.form.host')} required>
        <Input value={form.host} onChange={(event) => onChange('host', event.target.value)} />
      </Field>
      <Field label={t('connection.form.port')} required>
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
      <Field label={t('connection.form.username')} required={form.engine !== 'redis'}>
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
          <Field label={t('connection.form.sshHost')} required>
            <Input
              value={form.sshHost || ''}
              onChange={(event) => onChange('sshHost', event.target.value)}
            />
          </Field>
          <Field label={t('connection.form.sshPort')} required>
            <Input
              type="number"
              min={1}
              max={65535}
              value={form.sshPort || 22}
              onChange={(event) => onChange('sshPort', parsePortValue(event.target.value, 22))}
            />
          </Field>
          <Field label={t('connection.form.sshAuthMethod')} className="col-span-2">
            <div className="grid grid-cols-2 gap-2">
              {(['password', 'privateKey'] as const).map((method) => {
                const selected = sshAuthMethod === method
                return (
                  <button
                    key={method}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSSHAuthMethodChange(method)}
                    className={cn(
                      'h-9 rounded-md border border-border bg-canvas px-3 text-sm transition-colors hover:bg-hover',
                      selected && 'border-accent bg-accent/10 text-accent-text ring-1 ring-accent'
                    )}
                  >
                    {method === 'password'
                      ? t('connection.form.sshAuthPassword')
                      : t('connection.form.sshAuthPrivateKey')}
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label={t('connection.form.sshUsername')} required>
            <Input
              value={form.sshUsername || ''}
              onChange={(event) => onChange('sshUsername', event.target.value)}
            />
          </Field>
          {sshAuthMethod === 'password' ? (
            <Field label={connection?.hasSSHPassword ? t('connection.form.sshPasswordKeep') : t('connection.form.sshPassword')}>
              <Input
                type="password"
                value={form.sshPassword || ''}
                onChange={(event) => onChange('sshPassword', event.target.value)}
              />
            </Field>
          ) : (
            <>
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
                {form.sshPrivateKeyPath ? (
                  <p className="mb-2 truncate text-xs text-fg-muted" title={form.sshPrivateKeyPath}>
                    {t('connection.form.sshKeyPath', { path: form.sshPrivateKeyPath })}
                  </p>
                ) : null}
                <div
                  className={
                    draggingSSHKey
                      ? 'mb-2 rounded-md border border-accent bg-accent/10 px-3 py-2 text-sm text-accent-text'
                      : 'mb-2 rounded-md border border-dashed border-border bg-canvas/60 px-3 py-2 text-sm text-fg-muted'
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
                      variant="secondary"
                      size="sm"
                      onClick={() => sshKeyInputRef.current?.click()}
                    >
                      {t('connection.form.chooseFile')}
                    </Button>
                  </div>
                </div>
                <Textarea
                  mono
                  value={form.sshPrivateKey || ''}
                  onChange={(event) => onChange('sshPrivateKey', event.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  rows={4}
                />
              </Field>
              <Field label={t('connection.form.keyPassphrase')}>
                <Input
                  type="password"
                  value={form.sshPassphrase || ''}
                  onChange={(event) => onChange('sshPassphrase', event.target.value)}
                />
              </Field>
              <div />
            </>
          )}
        </>
      )}
    </div>
  )
}

function Field({
  label,
  children,
  className,
  required = false
}: {
  label: string
  children: ReactNode
  className?: string
  required?: boolean
}) {
  return (
    <div className={className}>
      <Label className="mb-1 block">
        {label}
        {required ? <span className="ml-0.5 text-danger-text">*</span> : null}
      </Label>
      {children}
    </div>
  )
}
