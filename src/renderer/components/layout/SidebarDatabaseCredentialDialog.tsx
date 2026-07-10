import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, KeyRound, Server, UserRound, XCircle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { useI18n } from '@renderer/i18n'
import { cn } from '@renderer/lib/utils'
import type { DatabaseCredentialDialogState } from './sidebar-types'

interface SidebarDatabaseCredentialDialogProps {
  dialog: DatabaseCredentialDialogState
  username: string
  password: string
  useDefault: boolean
  feedback: { level: 'success' | 'error'; message: string } | null
  busy: boolean
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onUseDefaultChange: (value: boolean) => void
  onOpenChange: (open: boolean) => void
  onTest: () => void | Promise<void>
  onSubmit: () => void | Promise<void>
}

export function SidebarDatabaseCredentialDialog({
  dialog,
  username,
  password,
  useDefault,
  feedback,
  busy,
  onUsernameChange,
  onPasswordChange,
  onUseDefaultChange,
  onOpenChange,
  onTest,
  onSubmit
}: SidebarDatabaseCredentialDialogProps) {
  const { t } = useI18n()
  const [showPassword, setShowPassword] = useState(false)
  const storedCredential = dialog.connection.databaseCredentials?.[dialog.database]

  useEffect(() => {
    setShowPassword(false)
  }, [dialog.connection.id, dialog.database])

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('sidebar.overlays.databaseCredentialTitle')}
      description={t('sidebar.overlays.databaseCredentialDescription')}
      className="max-w-md"
      footer={
        <>
          <Button variant="outline" className="mr-auto" onClick={onTest} disabled={busy}>
            {t('common.test')}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={busy || (useDefault && !storedCredential)}>
            {useDefault ? t('sidebar.overlays.useServerCredential') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-md border border-border bg-background/50 px-3 py-2.5 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{dialog.connection.name}</span>
          </div>
          <span className="text-muted-foreground">
            {dialog.connection.host}:{dialog.connection.port}
          </span>
          <div className="col-span-2 flex min-w-0 items-center gap-2 text-muted-foreground">
            <span className="shrink-0">{t('sidebar.overlays.targetDatabase')}</span>
            <span className="truncate font-medium text-foreground">{dialog.database}</span>
          </div>
        </div>

        <div>
          <Label className="mb-1.5 block">{t('sidebar.overlays.credentialSource')}</Label>
          <div className="grid grid-cols-2 rounded-md border border-border bg-background p-1">
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
          <div className="flex items-start gap-2 rounded-md border border-border bg-background/50 px-3 py-2.5 text-xs">
            <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate font-medium">{dialog.connection.username}</div>
              <div className="mt-0.5 text-muted-foreground">
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
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => setShowPassword((current) => !current)}
                  title={showPassword ? t('common.hidePassword') : t('common.showPassword')}
                  aria-label={showPassword ? t('common.hidePassword') : t('common.showPassword')}
                >
                  {showPassword
                    ? <EyeOff className="h-3.5 w-3.5" />
                    : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
        )}

        {feedback && (
          <div className={cn(
            'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
            feedback.level === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-destructive/50 bg-destructive/10 text-red-300'
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
          ? 'bg-accent font-medium text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
      onClick={onClick}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}
