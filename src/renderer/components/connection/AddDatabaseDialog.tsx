import { useEffect, useId, useRef, useState } from 'react'
import { Check, Database, Search } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { RadioGroup } from '@renderer/components/ui/radio-group'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useI18n } from '@renderer/i18n'
import { api, unwrap } from '@renderer/lib/api'
import type { SafeConnection } from '../../../shared/types'
import { useSidebarActions } from '../layout/sidebar-actions'
import { configuredDatabases } from './database-browsing'

type Operation = 'discover' | 'test' | 'save'
type FieldError = { field: 'database' | 'username'; message: string }

export function AddDatabaseDialog() {
  const connection = useSidebarStore((state) => state.addDatabaseConnection)
  const close = useSidebarStore((state) => state.setAddDatabaseConnection)
  return connection ? (
    <AddDatabaseForm key={connection.id} connection={connection} onClose={() => close(null)} />
  ) : null
}

function AddDatabaseForm({ connection, onClose }: { connection: SafeConnection; onClose: () => void }) {
  const savedConnection = useConnectionStore((state) => state.connections.find((item) => item.id === connection.id)) ?? connection
  const actions = useSidebarActions()
  const { t } = useI18n()
  const id = useId()
  const databaseInput = useRef<HTMLInputElement>(null)
  const usernameInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const operationRef = useRef<Operation | null>(null)
  const [database, setDatabase] = useState('')
  const [choices, setChoices] = useState<string[] | null>(null)
  const [account, setAccount] = useState<'inherit' | 'custom'>('inherit')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [operation, setOperation] = useState<Operation | null>(null)
  const [fieldError, setFieldError] = useState<FieldError | null>(null)
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null)
  const busy = operation !== null
  const existingDatabases = new Set(configuredDatabases(savedConnection))
  const alreadyAdded = existingDatabases.has(database.trim())
  const databaseError = alreadyAdded
    ? t('sidebar.browsing.databaseAlreadyAdded')
    : fieldError?.field === 'database' ? fieldError.message : null

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const clearFeedback = () => {
    setFeedback(null)
    setFieldError(null)
  }

  const chooseDatabase = (name: string) => {
    setDatabase(name)
    clearFeedback()
    databaseInput.current?.focus()
  }

  const validate = () => {
    if (!database.trim() || alreadyAdded) {
      setFieldError({ field: 'database', message: t(alreadyAdded ? 'sidebar.browsing.databaseAlreadyAdded' : 'sidebar.browsing.databaseRequired') })
      databaseInput.current?.focus()
      return false
    }
    if (account === 'custom' && !username.trim()) {
      setFieldError({ field: 'username', message: t('sidebar.toast.databaseUsernameRequired') })
      usernameInput.current?.focus()
      return false
    }
    return true
  }

  const perform = async (action: Operation) => {
    if (operationRef.current) return
    clearFeedback()
    if (action !== 'discover' && !validate()) return
    operationRef.current = action
    setOperation(action)
    try {
      if (action === 'discover') {
        const names = await unwrap(api.db.discoverDatabases(connection.id))
        if (mounted.current) setChoices([...new Set(names)].sort((a, b) => a.localeCompare(b)))
      } else {
        const credential = account === 'custom' ? { username: username.trim(), password } : {}
        if (action === 'test') {
          const result = await unwrap(api.connection.testDatabaseCredential(connection.id, database.trim(), credential))
          if (mounted.current) setFeedback({ error: false, message: result.message })
        } else {
          await actions.addDatabase(savedConnection, database.trim(), credential)
          if (mounted.current) onClose()
        }
      }
    } catch (error) {
      if (mounted.current) setFeedback({ error: true, message: error instanceof Error ? error.message : String(error) })
    } finally {
      operationRef.current = null
      if (mounted.current) setOperation(null)
    }
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('sidebar.browsing.addDatabase')}
      description={connection.name}
      initialFocus={databaseInput}
      dismissible={operation !== 'save'}
      onOpenChange={(open) => { if (!open && operation !== 'save') onClose() }}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <Button type="button" className="mr-auto" disabled={busy || alreadyAdded} loading={operation === 'test'} onClick={() => void perform('test')}>
            {t(operation === 'test' ? 'sidebar.browsing.testing' : 'common.test')}
          </Button>
          <Button type="button" disabled={operation === 'save'} onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form={`${id}-form`} variant="primary" disabled={busy || alreadyAdded} loading={operation === 'save'}>
            {t(operation === 'save' ? 'sidebar.browsing.saving' : 'common.save')}
          </Button>
        </div>
      }
    >
      <form id={`${id}-form`} className="flex flex-col gap-4" noValidate onSubmit={(event) => { event.preventDefault(); void perform('save') }}>
        <div>
          <Label htmlFor={`${id}-database`}>{t('sidebar.browsing.databaseName')}</Label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Input
              ref={databaseInput}
              id={`${id}-database`}
              className="min-w-0 flex-1 basis-40"
              value={database}
              disabled={busy}
              invalid={Boolean(databaseError)}
              aria-describedby={`${id}-database-hint`}
              autoComplete="off"
              spellCheck={false}
              placeholder={t('sidebar.browsing.databaseHint')}
              onChange={(event) => { setDatabase(event.target.value); clearFeedback() }}
            />
            <Button type="button" icon={Search} disabled={busy} loading={operation === 'discover'} onClick={() => void perform('discover')}>
              {t(operation === 'discover' ? 'sidebar.browsing.discovering' : 'sidebar.browsing.discover')}
            </Button>
          </div>
          <p id={`${id}-database-hint`} role={databaseError ? 'alert' : undefined} className={`mt-1.5 text-xs ${databaseError ? 'text-danger-text' : 'text-fg-muted'}`}>
            {databaseError ?? t('sidebar.browsing.addExistingHint')}
          </p>
          {choices !== null && (
            <div className="mt-2 rounded-md border border-border bg-canvas">
              <p role="status" className="px-2 py-1.5 text-xs text-fg-muted">
                {choices.length ? t('sidebar.browsing.discoveredChoices', { count: choices.length }) : t('sidebar.browsing.noDiscovered')}
              </p>
              {choices.length > 0 && (
                <ul aria-label={t('sidebar.browsing.discoveredList')} className="max-h-36 overflow-y-auto border-t border-border p-1">
                  {choices.map((name) => (
                    <li key={name}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        fullWidth
                        className="justify-start"
                        icon={database.trim() === name ? Check : Database}
                        disabled={busy || existingDatabases.has(name)}
                        aria-pressed={database.trim() === name}
                        onClick={() => chooseDatabase(name)}
                      >
                        <span className="min-w-0 flex-1 truncate text-left font-mono" title={name}>{name}</span>
                        {existingDatabases.has(name) && <Badge size="xs">{t('sidebar.browsing.alreadyAdded')}</Badge>}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <RadioGroup
            name={`${id}-account`}
            aria-label={t('sidebar.browsing.accountLabel')}
            value={account}
            onValueChange={(value) => { setAccount(value); clearFeedback() }}
            options={[
              { value: 'inherit', label: t('sidebar.browsing.inherit', { username: savedConnection.username }), disabled: busy },
              { value: 'custom', label: t('sidebar.browsing.otherAccount'), disabled: busy }
            ]}
          />
          {account === 'custom' && (
            <div className="space-y-3 rounded-md border border-border bg-canvas p-3">
              <p className="text-xs text-fg-muted">{t('sidebar.browsing.customAccountHint')}</p>
              <div>
                <Label htmlFor={`${id}-username`}>{t('connection.form.username')}</Label>
                <Input ref={usernameInput} id={`${id}-username`} className="mt-1" disabled={busy} value={username} autoComplete="username"
                  invalid={fieldError?.field === 'username'} aria-describedby={fieldError?.field === 'username' ? `${id}-username-error` : undefined}
                  onChange={(event) => { setUsername(event.target.value); clearFeedback() }} />
                {fieldError?.field === 'username' && <p id={`${id}-username-error`} role="alert" className="mt-1 text-xs text-danger-text">{fieldError.message}</p>}
              </div>
              <div>
                <Label htmlFor={`${id}-password`}>{t('connection.form.password')}</Label>
                <Input id={`${id}-password`} className="mt-1" disabled={busy} type="password" value={password} autoComplete="new-password"
                  onChange={(event) => { setPassword(event.target.value); clearFeedback() }} />
              </div>
            </div>
          )}
        </div>
        {feedback && <p role={feedback.error ? 'alert' : 'status'} className={`text-sm break-words ${feedback.error ? 'text-danger-text' : 'text-success-text'}`}>{feedback.message}</p>}
      </form>
    </Dialog>
  )
}
