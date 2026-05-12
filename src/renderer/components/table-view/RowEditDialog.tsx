// 行的新增 / 编辑弹窗。根据列类型选择不同输入控件。
import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Select } from '@renderer/components/ui/select'
import { useI18n, type Translator } from '@renderer/i18n'
import type { ColumnInfo } from '../../../shared/types'

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
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setValues(createInitialValues(mode, columns, row))
    setBusy(false)
    setError(null)
  }, [columns, mode, row])

  const hasChanges = useMemo(() => {
    if (mode === 'insert') {
      return columns.some((column) => {
        if (column.isAutoIncrement) return false
        return values[column.name] !== createInitialValue(column)
      })
    }
    if (!row) return false
    return columns.some((column) => row[column.name] !== values[column.name])
  }, [columns, mode, row, values])

  // 只提交真正改动过的字段（编辑场景下）
  const handleSubmit = async () => {
    setError(null)
    setBusy(true)
    try {
      const changes: Record<string, unknown> = {}
      if (mode === 'insert') {
        for (const column of columns) {
          const normalized = normalizeColumnValue(column, values[column.name], mode, t)
          if (column.isAutoIncrement && normalized == null) continue
          validateColumnValue(column, normalized, mode, t)
          changes[column.name] = normalized
        }
        await onSubmit(changes)
      } else {
        for (const column of columns) {
          const normalized = normalizeColumnValue(column, values[column.name], mode, t)
          validateColumnValue(column, normalized, mode, t)
          if (row && row[column.name] !== normalized) {
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
      className="max-w-4xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={busy || (mode === 'edit' && !hasChanges)}>
            {mode === 'insert' ? t('common.insert') : t('common.update')}
          </Button>
        </>
      }
    >
      <div className="grid max-h-[70vh] grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
        {columns.map((column) => (
          <div key={column.name}>
            <Label className="mb-1 block">
              <div className="flex flex-wrap items-center gap-1.5">
                <span>{column.name}</span>
                <span className="text-[10px] opacity-60">{column.type}</span>
                {column.isPrimaryKey && <span className="text-[10px] text-amber-400">{t('rowEdit.pk')}</span>}
                {!column.nullable && <span className="text-[10px] text-red-400">*</span>}
                {column.comment && (
                  <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                    {t('common.comment')}
                  </span>
                )}
              </div>
              {column.comment && (
                <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {column.comment}
                </div>
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
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
    </Dialog>
  )
}

function createInitialValues(
  mode: 'insert' | 'edit',
  columns: ColumnInfo[],
  row?: Record<string, unknown>
): Record<string, unknown> {
  if (mode === 'edit' && row) return { ...row }
  const init: Record<string, unknown> = {}
  for (const column of columns) {
    if (column.isAutoIncrement) continue
    init[column.name] = createInitialValue(column)
  }
  return init
}

function createInitialValue(column: ColumnInfo): unknown {
  return column.defaultValue ?? (column.nullable ? null : '')
}

function normalizeColumnValue(
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
    if (trimmed === '') {
      return column.nullable || column.isAutoIncrement ? null : ''
    }

    if (isNumericColumn(column)) {
      const numericValue = Number(trimmed)
      if (!Number.isFinite(numericValue)) {
        throw new Error(t('rowEdit.validNumber', { name: column.name }))
      }
      return numericValue
    }

    if (column.type === 'json') {
      try {
        JSON.parse(trimmed)
      } catch {
        throw new Error(t('rowEdit.validJson', { name: column.name }))
      }
    }

    return trimmed
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
  if (!column.nullable && (value === null || value === undefined || value === '')) {
    throw new Error(t('rowEdit.requiredField', { name: column.name }))
  }
}

function isNumericColumn(column: ColumnInfo): boolean {
  return (
    column.type.startsWith('int') ||
    column.type.startsWith('bigint') ||
    column.type.startsWith('tinyint') ||
    column.type.startsWith('smallint') ||
    column.type.startsWith('decimal') ||
    column.type.startsWith('float') ||
    column.type.startsWith('double')
  )
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
  if (c.type.startsWith('text') || c.type === 'json' || c.type.includes('blob')) {
    return (
      <textarea
        value={formatInputValue(c, value)}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="w-full rounded-md border border-input bg-background p-2 text-xs font-mono"
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

function formatInputValue(column: ColumnInfo, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (column.type === 'json') return formatJsonValue(value)
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

function formatJsonValue(value: unknown): string {
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  const text = String(value)
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
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
