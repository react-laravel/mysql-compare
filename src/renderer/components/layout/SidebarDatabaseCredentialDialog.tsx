import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, KeyRound, Server, UserRound, XCircle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { useI18n } from '@renderer/i18n'
import { cn } from '@renderer/lib/utils'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useSidebarActions } from './sidebar-actions'

/** Rendered only while `databaseCredentialDialog` is set; it reads the store. */
export function SidebarDatabaseCredentialDialog() {
  const { t } = useI18n()
  const actions = useSidebarActions()
  const dialog = useSidebarStore((state) => state.databaseCredentialDialog)
  const username = useSidebarStore((state) => state.databaseCredentialUsername)
  const password = useSidebarStore((state) => state.databaseCredentialPassword)
  const useDefault = useSidebarStore((state) => state.databaseCredentialUseDefault)
  const feedback = useSidebarStore((state) => state.databaseCredentialFeedback)
  const busy = useSidebarStore((state) => state.actionBusy)
  const setUsername = useSidebarStore((state) => state.setDatabaseCredentialUsername)
  const setPassword = useSidebarStore((state) => state.setDatabaseCredentialPassword)
  const setUseDefault = useSidebarStore((state) => state.setDatabaseCredentialUseDefault)
  const setFeedback = useSidebarStore((state) => state.setDatabaseCredentialFeedback)
  const setDialog = useSidebarStore((state) => state.setDatabaseCredentialDialog)
  const [showPassword, setShowPassword] = useState(false)

  const connectionId = dialog?.connection.id
  const database = dialog?.database

  useEffect(() => {
    setShowPassword(false)
  }, [connectionId, database])

  if (!dialog) return null

  const storedCredential = dialog.connection.databaseCredentials?.[dialog.database]

  const onOpenChange = (open: boolean) => {
    if (open || busy) return
    setDialog(null)
    setPassword('')
    setFeedback(null)
  }
  const onUsernameChange = (value: string) => {
    setUsername(value)
    setFeedback(null)
  }
  const onPasswordChange = (value: string) => {
    setPassword(value)
    setFeedback(null)
  }
  const onUseDefaultChange = (value: boolean) => {
    setUseDefault(value)
    setFeedback(null)
  }
  const onTest = () => void actions.testDatabaseCredential()
  const onSubmit = () => void actions.submitDatabaseCredential()

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('sidebar.overlays.databaseCredentialTitle')}
      description={t('sidebar.overlays.databaseCredentialDescription')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" className="mr-auto" onClick={onTest} disabled={busy}>
            {t('common.test')}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={busy || (useDefault && !storedCredential)}>
            {useDefault ? t('sidebar.overlays.useServerCredential') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-md border border-border bg-canvas/50 px-3 py-2.5 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <Server className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
            <span className="truncate font-medium">{dialog.connection.name}</span>
          </div>
          <span className="text-fg-muted">
            {dialog.connection.host}:{dialog.connection.port}
          </span>
          <div className="col-span-2 flex min-w-0 items-center gap-2 text-fg-muted">
            <span className="shrink-0">{t('sidebar.overlays.targetDatabase')}</span>
            <span className="truncate font-medium text-fg">{dialog.database}</span>
          </div>
        </div>

        <div>
          <Label className="mb-1.5 block">{t('sidebar.overlays.credentialSource')}</Label>
          <div className="grid grid-cols-2 rounded-md border border-border bg-canvas p-1">
            <CredentialSourceButton
              active={useDefault}
              icon={<Server className="h-3.5 w-3.5 shrink-0" />}
              label={t('sidebar.overlays.serverCredential')}
              onClick={() => onUseDefaultChange(true)}
            />
            <CredentialSourceButton
              active={!useDefault}
              icon={<KeyRound className="h-3.5 w-3.5 shrink-0" />}
              label={t('sidebar.overlays.customCredential')}
              onClick={() => onUseDefaultChange(false)}
            />
          </div>
        </div>

        {useDefault ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-canvas/50 px-3 py-2.5 text-xs">
            <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" />
            <div className="min-w-0">
              <div className="truncate font-medium">{dialog.connection.username}</div>
              <div className="mt-0.5 text-fg-muted">
                {t('sidebar.overlays.serverCredentialHint')}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="mb-1 block">{t('connection.form.username')}</Label>
              <Input
                value={username}
                autoComplete="username"
                onChange={(event) => onUsernameChange(event.target.value)}
                autoFocus
              />
            </div>
            <div>
              <Label className="mb-1 block">
                {storedCredential?.hasPassword
                  ? t('connection.form.passwordKeep')
                  : t('connection.form.password')}
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  autoComplete="new-password"
                  className="pr-9"
                  onChange={(event) => onPasswordChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void onTest()
                  }}
                />
                <IconButton
                  icon={showPassword ? EyeOff : Eye}
                  label={showPassword ? t('common.hidePassword') : t('common.showPassword')}
                  size="xs"
                  variant="ghost"
                  active={showPassword}
                  data-focus-inset
                  className="absolute top-1/2 right-1.5 -translate-y-1/2"
                  onClick={() => setShowPassword((current) => !current)}
                />
              </div>
            </div>
          </div>
        )}

        {feedback && (
          <div className={cn(
            'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
            feedback.level === 'success'
              ? 'border-success/30 bg-success-quiet text-success-text'
              : 'border-danger/30 bg-danger-quiet text-danger-text'
          )}>
            {feedback.level === 'success'
              ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span className="min-w-0 break-words">{feedback.message}</span>
          </div>
        )}
      </div>
    </Dialog>
  )
}

function CredentialSourceButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'flex h-8 min-w-0 items-center justify-center gap-1.5 rounded text-xs transition-colors',
        active
          ? 'bg-selected font-medium text-fg shadow-sm'
          : 'text-fg-muted hover:text-fg'
      )}
      onClick={onClick}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}
