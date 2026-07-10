import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CheckCircle2,
  CircleEllipsis,
  Copy,
  Download,
  Eraser,
  Eye,
  EyeOff,
  FileCode2,
  KeyRound,
  Pencil,
  RefreshCw,
  Server,
  Trash2,
  Unplug,
  Upload,
  UserRound,
  XCircle
} from 'lucide-react'
import { ConnectionDialog } from '@renderer/components/connection/ConnectionDialog'
import { ExportDatabaseDialog } from '@renderer/components/table-view/ExportDatabaseDialog'
import { ExportTableDialog } from '@renderer/components/table-view/ExportTableDialog'
import { ImportTableDialog } from '@renderer/components/table-view/ImportTableDialog'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Select } from '@renderer/components/ui/select'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import type { SafeConnection } from '../../../shared/types'
import type {
  CreateSQLDialogState,
  CreateRedisKeyDialogState,
  CreateRedisKeyPayload,
  CreateRedisKeyType,
  ConnectionMenuState,
  DatabaseCredentialDialogState,
  DatabaseMenuState,
  ExportDatabaseDialogState,
  ExportDialogState,
  ImportDialogState,
  RenameDialogState,
  TableMenuState
} from './sidebar-types'

interface SidebarOverlaysProps {
  creating: boolean
  editing: SafeConnection | null
  onConnectionDialogOpenChange: (open: boolean) => void
  onConnectionSaved: () => void
  onDeleteConnection: (connection: SafeConnection) => boolean | Promise<boolean>
  connectionMenu: ConnectionMenuState | null
  onCloseConnectionMenu: () => void
  onCloseDatabaseConnection: (menu: ConnectionMenuState) => void | Promise<void>
  onEditConnection: (connection: SafeConnection) => void
  tableMenu: TableMenuState | null
  onCloseTableMenu: () => void
  databaseMenu: DatabaseMenuState | null
  onCloseDatabaseMenu: () => void
  onOpenDatabaseDetails: (menu: DatabaseMenuState) => void
  onOpenDatabaseSQLConsole: (menu: DatabaseMenuState) => void
  onOpenDatabaseCredentialDialog: (menu: DatabaseMenuState) => void
  onCreateRedisKey: (menu: DatabaseMenuState) => void
  onExportDatabase: (menu: DatabaseMenuState) => void
  onRefreshDatabase: (menu: DatabaseMenuState) => void | Promise<void>
  onOpenTableDetails: (menu: TableMenuState) => void
  onRenameTable: (menu: TableMenuState) => void
  onCopyTable: (menu: TableMenuState) => void | Promise<void>
  onShowCreateSQL: (menu: TableMenuState) => void | Promise<void>
  onExportTable: (menu: TableMenuState) => void
  onImportTable: (menu: TableMenuState) => void
  onTruncateTable: (menu: TableMenuState) => void | Promise<void>
  onDropTable: (menu: TableMenuState) => void | Promise<void>
  renameDialog: RenameDialogState | null
  renameDraft: string
  actionBusy: boolean
  onRenameDraftChange: (value: string) => void
  onRenameDialogOpenChange: (open: boolean) => void
  onSubmitRename: () => void | Promise<void>
  createSQLDialog: CreateSQLDialogState | null
  onCreateSQLDialogOpenChange: (open: boolean) => void
  onCopyCreateSQL: () => void
  createRedisKeyDialog: CreateRedisKeyDialogState | null
  onCreateRedisKeyDialogOpenChange: (open: boolean) => void
  onSubmitCreateRedisKey: (payload: CreateRedisKeyPayload) => void | Promise<void>
  exportDialog: ExportDialogState | null
  onExportDialogOpenChange: (open: boolean) => void
  exportDatabaseDialog: ExportDatabaseDialogState | null
  onExportDatabaseDialogOpenChange: (open: boolean) => void
  importDialog: ImportDialogState | null
  onImportDialogOpenChange: (open: boolean) => void
  onImported: () => void | Promise<void>
  databaseCredentialDialog: DatabaseCredentialDialogState | null
  databaseCredentialUsername: string
  databaseCredentialPassword: string
  databaseCredentialUseDefault: boolean
  databaseCredentialFeedback: { level: 'success' | 'error'; message: string } | null
  onDatabaseCredentialUsernameChange: (value: string) => void
  onDatabaseCredentialPasswordChange: (value: string) => void
  onDatabaseCredentialUseDefaultChange: (value: boolean) => void
  onDatabaseCredentialDialogOpenChange: (open: boolean) => void
  onTestDatabaseCredential: () => void | Promise<void>
  onSubmitDatabaseCredential: () => void | Promise<void>
}

export function SidebarOverlays({
  creating,
  editing,
  onConnectionDialogOpenChange,
  onConnectionSaved,
  onDeleteConnection,
  connectionMenu,
  onCloseConnectionMenu,
  onCloseDatabaseConnection,
  onEditConnection,
  tableMenu,
  onCloseTableMenu,
  databaseMenu,
  onCloseDatabaseMenu,
  onOpenDatabaseDetails,
  onOpenDatabaseSQLConsole,
  onOpenDatabaseCredentialDialog,
  onCreateRedisKey,
  onExportDatabase,
  onRefreshDatabase,
  onOpenTableDetails,
  onRenameTable,
  onCopyTable,
  onShowCreateSQL,
  onExportTable,
  onImportTable,
  onTruncateTable,
  onDropTable,
  renameDialog,
  renameDraft,
  actionBusy,
  onRenameDraftChange,
  onRenameDialogOpenChange,
  onSubmitRename,
  createSQLDialog,
  onCreateSQLDialogOpenChange,
  onCopyCreateSQL,
  createRedisKeyDialog,
  onCreateRedisKeyDialogOpenChange,
  onSubmitCreateRedisKey,
  exportDialog,
  onExportDialogOpenChange,
  exportDatabaseDialog,
  onExportDatabaseDialogOpenChange,
  importDialog,
  onImportDialogOpenChange,
  onImported,
  databaseCredentialDialog,
  databaseCredentialUsername,
  databaseCredentialPassword,
  databaseCredentialUseDefault,
  databaseCredentialFeedback,
  onDatabaseCredentialUsernameChange,
  onDatabaseCredentialPasswordChange,
  onDatabaseCredentialUseDefaultChange,
  onDatabaseCredentialDialogOpenChange,
  onTestDatabaseCredential,
  onSubmitDatabaseCredential
}: SidebarOverlaysProps) {
  const { t } = useI18n()
  const [showDatabaseCredentialPassword, setShowDatabaseCredentialPassword] = useState(false)
  const tableIsRedis = tableMenu?.connection.engine === 'redis'
  const databaseIsRedis = databaseMenu?.connection.engine === 'redis'
  const databaseIsPostgres = databaseMenu?.connection.engine === 'postgres'

  useEffect(() => {
    setShowDatabaseCredentialPassword(false)
  }, [databaseCredentialDialog?.connection.id, databaseCredentialDialog?.database])
  return (
    <>
      {(creating || editing) && (
        <ConnectionDialog
          open
          connection={editing}
          onOpenChange={onConnectionDialogOpenChange}
          onSaved={onConnectionSaved}
          onDelete={onDeleteConnection}
        />
      )}

      {connectionMenu && (
        <div className="fixed inset-0 z-[80]" onClick={onCloseConnectionMenu}>
          <div
            className="absolute w-56 rounded-md border border-border bg-card p-1 shadow-xl"
            style={{ left: connectionMenu.x, top: connectionMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <TableMenuItem
              icon={<Unplug className="h-3.5 w-3.5" />}
              label={t('sidebar.overlays.closeDatabaseConnection')}
              onClick={() => onCloseDatabaseConnection(connectionMenu)}
            />
            <div className="my-1 h-px bg-border" />
            <TableMenuItem
              icon={<Pencil className="h-3.5 w-3.5" />}
              label={t('common.edit')}
              onClick={() => onEditConnection(connectionMenu.connection)}
            />
          </div>
        </div>
      )}

      {tableMenu && (
        <div className="fixed inset-0 z-[80]" onClick={onCloseTableMenu}>
          <div
            className="absolute w-56 rounded-md border border-border bg-card p-1 shadow-xl"
            style={{ left: tableMenu.x, top: tableMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <TableMenuItem
              icon={<CircleEllipsis className="h-3.5 w-3.5" />}
              label={t('sidebar.overlays.tableDetails')}
              onClick={() => onOpenTableDetails(tableMenu)}
            />
            {tableIsRedis ? (
              <>
                <div className="my-1 h-px bg-border" />
                <TableMenuItem
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.renameRedisKey')}
                  onClick={() => onRenameTable(tableMenu)}
                />
                <TableMenuItem
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.deleteRedisKey')}
                  onClick={() => onDropTable(tableMenu)}
                  danger
                />
              </>
            ) : (
              <>
                <div className="my-1 h-px bg-border" />
                <TableMenuItem
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.renameTable')}
                  onClick={() => onRenameTable(tableMenu)}
                />
                <TableMenuItem
                  icon={<Copy className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.copyToCopy', { table: tableMenu.table })}
                  onClick={() => onCopyTable(tableMenu)}
                />
                <TableMenuItem
                  icon={<FileCode2 className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.showCreateTable')}
                  onClick={() => onShowCreateSQL(tableMenu)}
                />
                <TableMenuItem
                  icon={<Download className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.exportEllipsis')}
                  onClick={() => onExportTable(tableMenu)}
                />
                <TableMenuItem
                  icon={<Upload className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.importEllipsis')}
                  onClick={() => onImportTable(tableMenu)}
                />
                <div className="my-1 h-px bg-border" />
                <TableMenuItem
                  icon={<Eraser className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.truncateTable')}
                  onClick={() => onTruncateTable(tableMenu)}
                  danger
                />
              </>
            )}
          </div>
        </div>
      )}

      {databaseMenu && (
        <div className="fixed inset-0 z-[80]" onClick={onCloseDatabaseMenu}>
          <div
            className="absolute w-56 rounded-md border border-border bg-card p-1 shadow-xl"
            style={{ left: databaseMenu.x, top: databaseMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <TableMenuItem
              icon={<CircleEllipsis className="h-3.5 w-3.5" />}
              label={t('sidebar.overlays.databaseDetails')}
              onClick={() => onOpenDatabaseDetails(databaseMenu)}
            />
            {!databaseIsRedis && (
              <>
                <div className="my-1 h-px bg-border" />
                <TableMenuItem
                  icon={<FileCode2 className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.openSqlConsole')}
                  onClick={() => onOpenDatabaseSQLConsole(databaseMenu)}
                />
                {databaseIsPostgres && (
                  <TableMenuItem
                    icon={<KeyRound className="h-3.5 w-3.5" />}
                    label={t('sidebar.overlays.databaseCredential')}
                    onClick={() => onOpenDatabaseCredentialDialog(databaseMenu)}
                  />
                )}
                <TableMenuItem
                  icon={<Download className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.exportDatabase')}
                  onClick={() => onExportDatabase(databaseMenu)}
                />
              </>
            )}
            {databaseIsRedis && (
              <>
                <div className="my-1 h-px bg-border" />
                <TableMenuItem
                  icon={<FileCode2 className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.newRedisKey')}
                  onClick={() => onCreateRedisKey(databaseMenu)}
                />
              </>
            )}
            <TableMenuItem
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              label={t('common.refresh')}
              onClick={() => onRefreshDatabase(databaseMenu)}
            />
          </div>
        </div>
      )}

      {databaseCredentialDialog && (
        <Dialog
          open
          onOpenChange={onDatabaseCredentialDialogOpenChange}
          title={t('sidebar.overlays.databaseCredentialTitle')}
          description={t('sidebar.overlays.databaseCredentialDescription')}
          className="max-w-md"
          footer={
            <>
              <Button
                variant="outline"
                className="mr-auto"
                onClick={onTestDatabaseCredential}
                disabled={actionBusy}
              >
                {t('common.test')}
              </Button>
              <Button variant="outline" onClick={() => onDatabaseCredentialDialogOpenChange(false)} disabled={actionBusy}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={onSubmitDatabaseCredential}
                disabled={actionBusy || (
                  databaseCredentialUseDefault &&
                  !databaseCredentialDialog.connection.databaseCredentials?.[databaseCredentialDialog.database]
                )}
              >
                {databaseCredentialUseDefault
                  ? t('sidebar.overlays.useServerCredential')
                  : t('common.save')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-md border border-border bg-background/50 px-3 py-2.5 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{databaseCredentialDialog.connection.name}</span>
              </div>
              <span className="text-muted-foreground">
                {databaseCredentialDialog.connection.host}:{databaseCredentialDialog.connection.port}
              </span>
              <div className="col-span-2 flex min-w-0 items-center gap-2 text-muted-foreground">
                <span className="shrink-0">{t('sidebar.overlays.targetDatabase')}</span>
                <span className="truncate font-medium text-foreground">{databaseCredentialDialog.database}</span>
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">{t('sidebar.overlays.credentialSource')}</Label>
              <div className="grid grid-cols-2 rounded-md border border-border bg-background p-1">
                <button
                  type="button"
                  aria-pressed={databaseCredentialUseDefault}
                  className={cn(
                    'flex h-8 min-w-0 items-center justify-center gap-1.5 rounded text-xs transition-colors',
                    databaseCredentialUseDefault
                      ? 'bg-accent font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => onDatabaseCredentialUseDefaultChange(true)}
                >
                  <Server className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t('sidebar.overlays.serverCredential')}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={!databaseCredentialUseDefault}
                  className={cn(
                    'flex h-8 min-w-0 items-center justify-center gap-1.5 rounded text-xs transition-colors',
                    !databaseCredentialUseDefault
                      ? 'bg-accent font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => onDatabaseCredentialUseDefaultChange(false)}
                >
                  <KeyRound className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t('sidebar.overlays.customCredential')}</span>
                </button>
              </div>
            </div>

            {databaseCredentialUseDefault ? (
              <div className="flex items-start gap-2 rounded-md border border-border bg-background/50 px-3 py-2.5 text-xs">
                <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{databaseCredentialDialog.connection.username}</div>
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
                    value={databaseCredentialUsername}
                    autoComplete="username"
                    onChange={(event) => onDatabaseCredentialUsernameChange(event.target.value)}
                    autoFocus
                  />
                </div>
                <div>
                  <Label className="mb-1 block">
                    {databaseCredentialDialog.connection.databaseCredentials?.[databaseCredentialDialog.database]?.hasPassword
                      ? t('connection.form.passwordKeep')
                      : t('connection.form.password')}
                  </Label>
                  <div className="relative">
                    <Input
                      type={showDatabaseCredentialPassword ? 'text' : 'password'}
                      value={databaseCredentialPassword}
                      autoComplete="new-password"
                      className="pr-9"
                      onChange={(event) => onDatabaseCredentialPasswordChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void onTestDatabaseCredential()
                      }}
                    />
                    <button
                      type="button"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      onClick={() => setShowDatabaseCredentialPassword((current) => !current)}
                      title={showDatabaseCredentialPassword ? t('common.hidePassword') : t('common.showPassword')}
                      aria-label={showDatabaseCredentialPassword ? t('common.hidePassword') : t('common.showPassword')}
                    >
                      {showDatabaseCredentialPassword
                        ? <EyeOff className="h-3.5 w-3.5" />
                        : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {databaseCredentialFeedback && (
              <div className={cn(
                'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
                databaseCredentialFeedback.level === 'success'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-destructive/50 bg-destructive/10 text-red-300'
              )}>
                {databaseCredentialFeedback.level === 'success'
                  ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span className="min-w-0 break-words">{databaseCredentialFeedback.message}</span>
              </div>
            )}
          </div>
        </Dialog>
      )}

      {renameDialog && (
        <Dialog
          open
          onOpenChange={onRenameDialogOpenChange}
          title={renameDialog.connection.engine === 'redis'
            ? t('sidebar.overlays.renameRedisKey')
            : t('sidebar.overlays.renameTable')}
          description={renameDialog.connection.engine === 'redis'
            ? `${renameDialog.database} / ${renameDialog.table}`
            : t('sidebar.overlays.renameDescription', {
                db: renameDialog.database,
                table: renameDialog.table
              })}
          className="max-w-md"
          footer={
            <>
              <Button variant="outline" onClick={() => onRenameDialogOpenChange(false)} disabled={actionBusy}>
                {t('common.cancel')}
              </Button>
              <Button onClick={onSubmitRename} disabled={actionBusy || !renameDraft.trim()}>
                {t('common.rename')}
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            <Label className="block">
              {renameDialog.connection.engine === 'redis' ? t('redis.keyName') : t('sidebar.overlays.newTableName')}
            </Label>
            <Input value={renameDraft} onChange={(event) => onRenameDraftChange(event.target.value)} />
          </div>
        </Dialog>
      )}

      {createSQLDialog && (
        <Dialog
          open
          onOpenChange={onCreateSQLDialogOpenChange}
          title={t('sidebar.overlays.createTableTitle')}
          description={createSQLDialog.title}
          className="max-w-4xl"
          footer={
            <>
              <Button variant="outline" onClick={() => onCreateSQLDialogOpenChange(false)}>
                {t('common.close')}
              </Button>
              <Button
                onClick={onCopyCreateSQL}
                disabled={createSQLDialog.loading || !createSQLDialog.sql}
              >
                {t('common.copySql')}
              </Button>
            </>
          }
        >
          {createSQLDialog.loading ? (
            <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
          ) : (
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-card p-3 text-xs">
              {createSQLDialog.sql}
            </pre>
          )}
        </Dialog>
      )}

      {createRedisKeyDialog && (
        <RedisKeyCreateDialog
          dialog={createRedisKeyDialog}
          busy={actionBusy}
          onOpenChange={onCreateRedisKeyDialogOpenChange}
          onSubmit={onSubmitCreateRedisKey}
        />
      )}

      {exportDialog && (
        <ExportTableDialog
          open
          onOpenChange={onExportDialogOpenChange}
          connectionId={exportDialog.connectionId}
          database={exportDialog.database}
          table={exportDialog.table}
          availableScopes={['all']}
        />
      )}

      {exportDatabaseDialog && (
        <ExportDatabaseDialog
          open
          onOpenChange={onExportDatabaseDialogOpenChange}
          connectionId={exportDatabaseDialog.connectionId}
          database={exportDatabaseDialog.database}
        />
      )}

      {importDialog && (
        <ImportTableDialog
          open
          onOpenChange={onImportDialogOpenChange}
          connectionId={importDialog.connection.id}
          database={importDialog.database}
          table={importDialog.table}
          onImported={onImported}
        />
      )}
    </>
  )
}

function RedisKeyCreateDialog({
  dialog,
  busy,
  onOpenChange,
  onSubmit
}: {
  dialog: CreateRedisKeyDialogState
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: CreateRedisKeyPayload) => void | Promise<void>
}) {
  const { t } = useI18n()
  const [keyName, setKeyName] = useState('')
  const [type, setType] = useState<CreateRedisKeyType>('string')
  const [value, setValue] = useState('')
  const [field, setField] = useState('')
  const [member, setMember] = useState('')
  const [score, setScore] = useState('0')
  const [ttlSeconds, setTtlSeconds] = useState('')
  const [fieldsJson, setFieldsJson] = useState('{\n  "field": "value"\n}')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setKeyName('')
    setType('string')
    setValue('')
    setField('')
    setMember('')
    setScore('0')
    setTtlSeconds('')
    setFieldsJson('{\n  "field": "value"\n}')
    setError(null)
  }, [dialog.connection.id, dialog.database])

  const typeOptions = useMemo(
    () => [
      { value: 'string', label: 'String' },
      { value: 'hash', label: 'Hash' },
      { value: 'list', label: 'List' },
      { value: 'set', label: 'Set' },
      { value: 'zset', label: 'Sorted Set' },
      { value: 'stream', label: 'Stream' }
    ],
    []
  )

  const submit = async () => {
    setError(null)
    try {
      const trimmedKey = keyName.trim()
      if (!trimmedKey) throw new Error(t('redis.keyRequired'))
      const ttl = ttlSeconds.trim() ? Number(ttlSeconds.trim()) : undefined
      if (ttl !== undefined && (!Number.isInteger(ttl) || ttl < 0)) {
        throw new Error(t('redis.validTtl'))
      }

      const payload: CreateRedisKeyPayload = { key: trimmedKey, type, ttlSeconds: ttl }

      if (type === 'hash') {
        if (!field.trim()) throw new Error(t('redis.fieldRequired'))
        payload.field = field.trim()
        payload.value = value
      } else if (type === 'set') {
        if (!member.trim()) throw new Error(t('redis.memberRequired'))
        payload.member = member
      } else if (type === 'zset') {
        if (!member.trim()) throw new Error(t('redis.memberRequired'))
        const parsedScore = Number(score)
        if (!Number.isFinite(parsedScore)) throw new Error(t('redis.validScore'))
        payload.member = member
        payload.score = parsedScore
      } else if (type === 'stream') {
        const parsed = JSON.parse(fieldsJson) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error(t('redis.validFieldsJson'))
        }
        payload.fields = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([name, fieldValue]) => [
            name,
            fieldValue == null ? '' : String(fieldValue)
          ])
        )
      } else {
        payload.value = value
      }

      await onSubmit(payload)
    } catch (submitError) {
      setError((submitError as Error).message)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('redis.createKey')}
      description={`${dialog.connection.name} / ${dialog.database}`}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy || !keyName.trim()}>
            {t('common.insert')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label className="mb-1 block">{t('redis.keyName')}</Label>
          <Input value={keyName} onChange={(event) => setKeyName(event.target.value)} />
        </div>
        <div>
          <Label className="mb-1 block">{t('common.type')}</Label>
          <Select
            value={type}
            options={typeOptions}
            onChange={(event) => setType(event.target.value as CreateRedisKeyType)}
          />
        </div>
        {type === 'hash' && (
          <div>
            <Label className="mb-1 block">{t('redis.field')}</Label>
            <Input value={field} onChange={(event) => setField(event.target.value)} />
          </div>
        )}
        {(type === 'set' || type === 'zset') && (
          <div>
            <Label className="mb-1 block">{t('redis.member')}</Label>
            <Input value={member} onChange={(event) => setMember(event.target.value)} />
          </div>
        )}
        {type === 'zset' && (
          <div>
            <Label className="mb-1 block">{t('redis.score')}</Label>
            <Input value={score} onChange={(event) => setScore(event.target.value)} />
          </div>
        )}
        <div>
          <Label className="mb-1 block">{t('redis.ttlSeconds')}</Label>
          <Input value={ttlSeconds} onChange={(event) => setTtlSeconds(event.target.value)} />
        </div>
        {type === 'stream' ? (
          <div className="md:col-span-2">
            <Label className="mb-1 block">{t('redis.fieldsJson')}</Label>
            <textarea
              value={fieldsJson}
              onChange={(event) => setFieldsJson(event.target.value)}
              rows={7}
              className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
            />
          </div>
        ) : type !== 'set' && type !== 'zset' ? (
          <div className="md:col-span-2">
            <Label className="mb-1 block">{t('common.content')}</Label>
            <textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              rows={7}
              className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
            />
          </div>
        ) : null}
      </div>
      {error && (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
    </Dialog>
  )
}

function TableMenuItem({
  icon,
  label,
  onClick,
  danger = false
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent',
        danger && 'text-red-300 hover:bg-red-500/10'
      )}
      onClick={onClick}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
