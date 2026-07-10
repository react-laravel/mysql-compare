import { useEffect, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Select } from '@renderer/components/ui/select'
import { useI18n } from '@renderer/i18n'
import type {
  CreateRedisKeyDialogState,
  CreateRedisKeyPayload,
  CreateRedisKeyType
} from './sidebar-types'

const REDIS_KEY_TYPE_OPTIONS: Array<{ value: CreateRedisKeyType; label: string }> = [
  { value: 'string', label: 'String' },
  { value: 'hash', label: 'Hash' },
  { value: 'list', label: 'List' },
  { value: 'set', label: 'Set' },
  { value: 'zset', label: 'Sorted Set' },
  { value: 'stream', label: 'Stream' }
]

interface RedisKeyCreateDialogProps {
  dialog: CreateRedisKeyDialogState
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: CreateRedisKeyPayload) => void | Promise<void>
}

export function RedisKeyCreateDialog({
  dialog,
  busy,
  onOpenChange,
  onSubmit
}: RedisKeyCreateDialogProps) {
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
            options={REDIS_KEY_TYPE_OPTIONS}
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
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </Dialog>
  )
}
