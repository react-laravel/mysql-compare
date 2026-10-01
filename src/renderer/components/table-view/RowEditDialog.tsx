// 行的新增 / 编辑弹窗。根据列类型选择不同输入控件。
import { useEffect, useMemo, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input, Textarea } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Select } from '@renderer/components/ui/select'
import { useI18n, type Translator } from '@renderer/i18n'
import type { ColumnInfo } from '../../../shared/types'
import { JsonViewerTrigger } from './JsonViewerTrigger'
import {
  formatInputValue,
  isRowEditValueEqual,
  prepareRowEditValues
} from './row-edit-dialog-utils'

const NULL_ENUM_SELECT_VALUE = '__mysql_compare_null__'
const EMPTY_ENUM_PLACEHOLDER_VALUE = '__mysql_compare_empty__'

interface Props {
  mode: 'insert' | 'edit'
  columns: ColumnInfo[]
  primaryKey: string[]
  row?: Record<string, unknown>
  onClose: () => void
  onSubmit: (values: Record<string, unknown>, pkOld?: Record<string, unknown>) => Promise<void>
}

export function RowEditDialog({ mode, columns, primaryKey, row, onClose, onSubmit }: Props) {
  const { t } = useI18n()
  const loadedColumns = useMemo(() => mode === 'edit' ? columns.filter((column) => Object.hasOwn(row ?? {}, column.name)) : columns, [columns, mode, row])
  const unloadedColumnCount = mode === 'edit' ? columns.length - loadedColumns.length : 0
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setValues(prepareRowEditValues(mode, loadedColumns, row))
    setBusy(false)
    setError(null)
  }, [loadedColumns, mode, row])

  const hasChanges = useMemo(() => {
    if (mode === 'insert') {
      return loadedColumns.some((column) => {
        if (column.isGenerated || column.isAutoIncrement) return false
        return values[column.name] !== createInitialValue(column)
      })
    }
    if (!row) return false
    return loadedColumns.some((column) =>
      !column.isGenerated && !isRowEditValueEqual(column, row[column.name], values[column.name])
    )
  }, [loadedColumns, mode, row, values])

  // 只提交真正改动过的字段（编辑场景下）
  const handleSubmit = async () => {
    setError(null)
    setBusy(true)
    try {
      const changes: Record<string, unknown> = {}
      if (mode === 'insert') {
        for (const column of loadedColumns.filter((column) => !column.isGenerated)) {
          const normalized = normalizeColumnValue(column, values[column.name], mode, t)
          if (column.isAutoIncrement && normalized == null) continue
          validateColumnValue(column, normalized, mode, t)
          changes[column.name] = normalized
        }
        await onSubmit(changes)
      } else {
        for (const column of loadedColumns.filter((column) => !column.isGenerated)) {
          const normalized = normalizeColumnValue(column, values[column.name], mode, t)
          validateColumnValue(column, normalized, mode, t)
          if (row && !isRowEditValueEqual(column, row[column.name], normalized)) {
            changes[column.name] = normalized
          }
        }
        const pkOld: Record<string, unknown> = {}
        for (const key of primaryKey) pkOld[key] = row?.[key]
        await onSubmit(changes, pkOld)
      }
    } catch (submitError) {
      setError((submitError as Error).message)
      return
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={mode === 'insert' ? t('rowEdit.insertTitle') : t('rowEdit.editTitle')}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={busy || (mode === 'edit' && !hasChanges)}>
            {mode === 'insert' ? t('common.insert') : t('common.update')}
          </Button>
        </>
      }
    >
      {unloadedColumnCount > 0 ? <p role="status" className="mb-3 text-xs text-fg-muted">{t('rowEdit.unloadedColumnsHint', { count: unloadedColumnCount })}</p> : null}
      <div className="grid max-h-[70vh] grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
        {loadedColumns.filter((column) => !column.isGenerated).map((column) => (
          <div key={column.name}>
            <Label className="mb-1 block">
              <div className="flex flex-wrap items-center gap-1.5">
                <span>{column.name}</span>
                <span className="font-mono text-2xs text-fg-subtle">{column.type}</span>
                {column.isPrimaryKey && (
                  <Badge size="xs" tone="warning" icon={KeyRound}>
                    {t('rowEdit.pk')}
                  </Badge>
                )}
                {!column.nullable && (
                  <span className="text-2xs text-danger-text" title={t('rowEdit.required')}>
                    *
                  </span>
                )}
                {column.comment && (
                  <Badge size="xs" tone="neutral">
                    {t('common.comment')}
                  </Badge>
                )}
              </div>
              {column.comment && (
                <div className="mt-1 text-xs leading-4 text-fg-muted">{column.comment}</div>
              )}
            </Label>
            {renderInput(column, values[column.name], t, (nextValue) => {
              setError(null)
              setValues((state) => ({ ...state, [column.name]: nextValue }))
            })}
          </div>
        ))}
      </div>
      {error && (
        <div role="alert" className="mt-3 rounded-md border border-danger/30 bg-danger-quiet px-3 py-2 text-sm text-danger-text">
          {error}
        </div>
      )}
    </Dialog>
  )
}

function createInitialValue(column: ColumnInfo): unknown {
  return column.defaultValue ?? (column.nullable ? null : '')
}

export function normalizeColumnValue(
  column: ColumnInfo,
  value: unknown,
  mode: 'insert' | 'edit',
  t: Translator
): unknown {
  if (column.type === 'tinyint(1)') {
    return value === 1 || value === true || value === '1' ? 1 : 0
  }

  if (value === undefined) {
    return mode === 'insert' ? null : value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (isNumericColumn(column)) {
      if (trimmed === '' && (column.nullable || column.isAutoIncrement)) return null
      const integer = /^(?:tinyint|smallint|mediumint|int|integer|bigint)\b/i.test(column.type)
      const valid = integer ? /^[+-]?\d+$/.test(trimmed) : /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)
      if (!valid) throw new Error(t('rowEdit.validNumber', { name: column.name }))
      // Decimal and large integer strings must reach the driver unchanged.
      const number = Number(trimmed)
      return integer && Number.isSafeInteger(number) ? number : trimmed
    }

    if (column.type === 'json' || column.type === 'jsonb') {
      try {
        JSON.parse(trimmed)
      } catch {
        throw new Error(t('rowEdit.validJson', { name: column.name }))
      }
    }

    return value
  }

  return value
}

function validateColumnValue(
  column: ColumnInfo,
  value: unknown,
  mode: 'insert' | 'edit',
  t: Translator
): void {
  if (column.isAutoIncrement && mode === 'insert' && value == null) return
  if (!column.nullable && (value === null || value === undefined)) {
    throw new Error(t('rowEdit.requiredField', { name: column.name }))
  }
}

function isNumericColumn(column: ColumnInfo): boolean {
  return /^(?:tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real)\b/i.test(column.type)
}

function renderInput(
  c: ColumnInfo,
  value: unknown,
  t: Translator,
  onChange: (v: unknown) => void
): React.ReactNode {
  const enumOptions = getEnumOptions(c)

  // tinyint(1) → boolean
  if (c.type === 'tinyint(1)') {
    return (
      <Checkbox
        checked={value === 1 || value === true || value === '1'}
        onChange={(e) => onChange(e.target.checked ? 1 : 0)}
      />
    )
  }
  if (enumOptions.length > 0) {
    const stringValue = value == null ? '' : String(value)
    const selectValue = getEnumSelectValue(stringValue, c.nullable, enumOptions, value)
    const options = buildEnumSelectOptions(enumOptions, c.nullable, selectValue, stringValue, t)

    return (
      <Select
        value={selectValue}
        options={options}
        onChange={(e) => onChange(parseEnumSelectValue(e.target.value, c.nullable))}
      />
    )
  }
  if (c.type === 'json' || c.type === 'jsonb') {
    return (
      <div className="flex min-w-0 items-start gap-1.5">
        <Textarea
          mono
          value={formatInputValue(c, value)}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="min-w-0 flex-1"
        />
        <JsonViewerTrigger
          column={c}
          row={{ [c.name]: value }}
          content={formatInputValue(c, value)}
          onSave={async (_row, _column, nextValue) => {
            onChange(nextValue)
          }}
        />
      </div>
    )
  }
  if (c.type.startsWith('text') || c.type.includes('blob')) {
    return (
      <Textarea
        mono
        value={formatInputValue(c, value)}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
      />
    )
  }
  if (isNumericColumn(c)) {
    return (
      <Input
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  // 默认 string
  return (
    <Input
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function getEnumOptions(column: ColumnInfo): string[] {
  const match = /^enum\((.*)\)$/i.exec(column.type.trim())
  if (!match) return []

  return parseEnumValues(match[1] ?? '')
}

function parseEnumValues(raw: string): string[] {
  const values: string[] = []
  let index = 0

  while (index < raw.length) {
    while (index < raw.length && (raw[index] === ',' || /\s/.test(raw[index] ?? ''))) {
      index += 1
    }
    if (index >= raw.length || raw[index] !== "'") break

    index += 1
    let value = ''

    while (index < raw.length) {
      const char = raw[index]!
      const nextChar = raw[index + 1]

      if (char === '\\' && nextChar) {
        value += nextChar
        index += 2
        continue
      }

      if (char === "'" && nextChar === "'") {
        value += "'"
        index += 2
        continue
      }

      if (char === "'") {
        index += 1
        break
      }

      value += char
      index += 1
    }

    values.push(value)
  }

  return values
}

function buildEnumSelectOptions(
  enumOptions: string[],
  nullable: boolean,
  selectValue: string,
  currentValue: string,
  t: Translator
): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []

  if (nullable) {
    options.push({ value: NULL_ENUM_SELECT_VALUE, label: 'NULL' })
  }

  if (selectValue === EMPTY_ENUM_PLACEHOLDER_VALUE) {
    options.push({ value: EMPTY_ENUM_PLACEHOLDER_VALUE, label: t('rowEdit.select') })
  }

  if (currentValue !== '' && !enumOptions.includes(currentValue)) {
    options.push({ value: currentValue, label: currentValue })
  }

  options.push(
    ...enumOptions.map((option) => ({
      value: option,
      label: option === '' ? t('rowEdit.emptyString') : option
    }))
  )

  return options
}

function getEnumSelectValue(
  currentValue: string,
  nullable: boolean,
  enumOptions: string[],
  rawValue: unknown
): string {
  if (rawValue == null) {
    return nullable ? NULL_ENUM_SELECT_VALUE : EMPTY_ENUM_PLACEHOLDER_VALUE
  }

  if (currentValue === '' && !enumOptions.includes('')) {
    return EMPTY_ENUM_PLACEHOLDER_VALUE
  }

  return currentValue
}

function parseEnumSelectValue(value: string, nullable: boolean): string | null {
  if (value === NULL_ENUM_SELECT_VALUE) return null
  if (value === EMPTY_ENUM_PLACEHOLDER_VALUE) {
    return nullable ? null : ''
  }

  return value
}
