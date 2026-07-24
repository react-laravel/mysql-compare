import { useEffect, useMemo, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { ClipboardCopy, FileUp, FolderOpen, History, Play, RotateCcw, Rows3, ScanSearch, SplitSquareVertical } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Table, TBody, Td, THead, Th, Tr } from '@renderer/components/ui/table'
import { api, unwrap } from '@renderer/lib/api'
import { cn, formatCellValue } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n, type Translator } from '@renderer/i18n'
import { useTheme } from '@renderer/theme'
import type { DbEngine, ExplainPlanNode, ExplainSQLResult } from '../../../shared/types'

interface Props {
  connectionId: string
  connectionName?: string
  database: string
  engine?: DbEngine
}

type SQLExecutionResult =
  | { kind: 'rows'; columns: string[]; rows: Record<string, unknown>[] }
  | { kind: 'mutation'; affectedRows: number; insertId?: number | string; warningStatus?: number }
  | { kind: 'batch'; statements: number; affectedRows: number; details: string[] }
  | { kind: 'explain'; result: ExplainSQLResult }
  | { kind: 'empty'; message: string }

interface SQLHistoryEntry {
  id: string
  sql: string
  ranAt: number
}

const SQL_EDITOR_SIZE_STORAGE_KEY = 'mysql-compare:sql-editor-percent'
const MAX_SQL_HISTORY = 20

function clampEditorPercent(value: number): number {
  return Math.max(25, Math.min(75, value))
}

function readStoredEditorPercent(): number {
  if (typeof window === 'undefined') return 42
  const raw = window.localStorage.getItem(SQL_EDITOR_SIZE_STORAGE_KEY)
  const parsed = raw ? Number.parseFloat(raw) : Number.NaN
  return Number.isFinite(parsed) ? clampEditorPercent(parsed) : 42
}

function getHistoryStorageKey(connectionId: string, database: string): string {
  return `mysql-compare:sql-history:${connectionId}:${database}`
}

function readSQLHistory(connectionId: string, database: string): SQLHistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(getHistoryStorageKey(connectionId, database))
    if (!raw) return []
    const parsed = JSON.parse(raw) as SQLHistoryEntry[]
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry?.id && entry.sql).slice(0, MAX_SQL_HISTORY)
      : []
  } catch {
    return []
  }
}

function writeSQLHistory(connectionId: string, database: string, history: SQLHistoryEntry[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(getHistoryStorageKey(connectionId, database), JSON.stringify(history))
  } catch {
    /* ignore */
  }
}

export function SQLQueryView({ connectionId, connectionName, database, engine }: Props) {
  const { showToast } = useUIStore()
  const { t } = useI18n()
  const { theme } = useTheme()
  const [sql, setSQL] = useState(() => t('sql.placeholder'))
  const [selectedSQL, setSelectedSQL] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SQLExecutionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<SQLHistoryEntry[]>(() => readSQLHistory(connectionId, database))
  const [editorPercent, setEditorPercent] = useState(() => readStoredEditorPercent())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const runSQLRef = useRef<(statementOverride?: string) => Promise<void>>(async () => undefined)
  const splitContainerRef = useRef<HTMLDivElement | null>(null)
  const resizeStateRef = useRef<{ top: number; height: number } | null>(null)

  const subtitle = useMemo(() => {
    if (connectionName) return `${connectionName} / ${database}`
    return database
  }, [connectionName, database])
  const canExplain = engine === 'mysql' || engine === 'postgres' || engine === undefined

  useEffect(() => {
    setHistory(readSQLHistory(connectionId, database))
  }, [connectionId, database])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SQL_EDITOR_SIZE_STORAGE_KEY, String(editorPercent))
  }, [editorPercent])

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const state = resizeStateRef.current
      if (!state) return
      const nextPercent = ((event.clientY - state.top) / state.height) * 100
      setEditorPercent(clampEditorPercent(nextPercent))
    }

    const onMouseUp = () => {
      if (!resizeStateRef.current) return
      resizeStateRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const syncSelectedSQL = () => {
    const editor = editorRef.current
    if (!editor) {
      setSelectedSQL('')
      return
    }
    const selection = editor.getSelection()
    const model = editor.getModel()
    if (!selection || !model || selection.isEmpty()) {
      setSelectedSQL('')
      return
    }
    setSelectedSQL(model.getValueInRange(selection).trim())
  }

  const rememberStatement = (statement: string) => {
    setHistory((current) => {
      const normalized = statement.trim()
      const next = [
        { id: `${Date.now()}`, sql: normalized, ranAt: Date.now() },
        ...current.filter((entry) => entry.sql.trim() !== normalized)
      ].slice(0, MAX_SQL_HISTORY)
      writeSQLHistory(connectionId, database, next)
      return next
    })
  }

  const runSQL = async (statementOverride?: string) => {
    const source = statementOverride ?? (selectedSQL || sql)
    const statement = source.trim()
    if (!statement) {
      showToast(t('sql.empty'), 'error')
      return
    }
    setRunning(true)
    setError(null)
    try {
      const raw = await unwrap(api.db.executeSQL(connectionId, statement, database))
      const normalized = normalizeResult(raw, t)
      setResult(normalized)
      rememberStatement(statement)
      showToast(t('sql.executed'), 'success')
    } catch (err) {
      const message = (err as Error).message
      setError(message)
      showToast(message, 'error')
    } finally {
      setRunning(false)
    }
  }

  runSQLRef.current = runSQL

  const onEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    editor.onDidChangeCursorSelection(() => {
      syncSelectedSQL()
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      void runSQLRef.current()
    })
  }

  const runExplain = async () => {
    const statement = (selectedSQL || sql).trim()
    if (!statement) {
      showToast(t('sql.empty'), 'error')
      return
    }
    setRunning(true)
    setError(null)
    try {
      const explain = await unwrap(api.db.explainSQL({ connectionId, database, sql: statement }))
      setResult({ kind: 'explain', result: explain })
      rememberStatement(statement)
      showToast(t('sql.explained'), 'success')
    } catch (err) {
      const message = (err as Error).message
      setError(message)
      showToast(message, 'error')
    } finally {
      setRunning(false)
    }
  }

  const importFile = async (file: File | null | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      setSQL(text)
      showToast(t('sql.loaded', { name: file.name }), 'success')
    } catch (err) {
      showToast((err as Error).message || t('sql.readFailed'), 'error')
    }
  }

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    const container = splitContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    resizeStateRef.current = { top: rect.top, height: rect.height }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    event.preventDefault()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border bg-card px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t('sql.consoleTitle')}</div>
            <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setHistoryOpen(true)}
              disabled={history.length === 0}
            >
              <History className="h-4 w-4" /> {t('sql.history')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSQL(t('sql.placeholder'))} disabled={running}>
              <RotateCcw className="h-4 w-4" /> {t('sql.reset')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={running}
            >
              <FolderOpen className="h-4 w-4" /> {t('sql.openFile')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => runSQL(selectedSQL)} disabled={running || !selectedSQL}>
              <Rows3 className="h-4 w-4" /> {t('sql.runSelected')}
            </Button>
            {canExplain && (
              <Button size="sm" variant="outline" onClick={runExplain} disabled={running}>
                <ScanSearch className="h-4 w-4" /> {t('sql.explain')}
              </Button>
            )}
            <Button size="sm" onClick={() => runSQL()} disabled={running}>
              <Play className="h-4 w-4" /> {running ? t('sql.running') : t('sql.run')}
            </Button>
          </div>
        </div>
      </div>

      <div
        ref={splitContainerRef}
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateRows: `minmax(180px, ${editorPercent}%) 6px minmax(0, 1fr)`
        }}
      >
        <div
          className={cn(
            'flex min-h-0 flex-col p-3 transition-colors',
            dragging && 'bg-accent/40'
          )}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void importFile(event.dataTransfer.files?.[0])
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".sql,.txt,.csv,text/plain"
            className="hidden"
            onChange={(event) => {
              void importFile(event.target.files?.[0])
              event.currentTarget.value = ''
            }}
          />
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-input">
            <Editor
              height="100%"
              language="sql"
              theme={theme === 'dark' ? 'vs-dark' : 'light'}
              value={sql}
              onChange={(value) => {
                setSQL(value ?? '')
                requestAnimationFrame(syncSelectedSQL)
              }}
              onMount={onEditorMount}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                wordWrap: 'on',
                automaticLayout: true,
                smoothScrolling: true,
                scrollBeyondLastLine: false,
                tabSize: 2,
                renderLineHighlight: 'line',
                padding: { top: 12, bottom: 12 }
              }}
            />
          </div>
          <div className="mt-2 flex shrink-0 items-center gap-2 text-xs leading-5 text-muted-foreground">
            <FileUp className="h-3.5 w-3.5" />
            <span className="truncate">
              {selectedSQL ? t('sql.selectionActive', { count: selectedSQL.length }) : t('sql.dropFileHint')}
            </span>
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('sql.resizeEditor')}
          className="group flex cursor-row-resize items-center justify-center border-y border-border bg-card/80"
          onMouseDown={startResize}
          onDoubleClick={() => setEditorPercent(42)}
        >
          <SplitSquareVertical className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
        </div>

        <div className="min-h-0 overflow-hidden p-3">
          {error ? (
            <div className="max-h-full overflow-auto rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-red-200 whitespace-pre-wrap break-all">
              {error}
            </div>
          ) : result ? (
            <ResultPanel result={result} />
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
              {t('sql.runHint', { subtitle })}
            </div>
          )}
        </div>
      </div>

      {historyOpen && (
        <Dialog
          open
          onOpenChange={setHistoryOpen}
          title={t('sql.history')}
          description={t('sql.historyDescription')}
          className="max-w-3xl"
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setHistory([])
                  writeSQLHistory(connectionId, database, [])
                }}
                disabled={history.length === 0}
              >
                {t('sql.clearHistory')}
              </Button>
              <Button onClick={() => setHistoryOpen(false)}>{t('common.close')}</Button>
            </>
          }
        >
          <div className="max-h-[60vh] space-y-2 overflow-auto">
            {history.map((entry) => (
              <div key={entry.id} className="rounded-md border border-border bg-background p-2">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{new Date(entry.ranAt).toLocaleString()}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSQL(entry.sql)
                        setHistoryOpen(false)
                      }}
                    >
                      {t('sql.loadHistory')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setHistoryOpen(false)
                        void runSQL(entry.sql)
                      }}
                    >
                      <Play className="h-4 w-4" /> {t('sql.run')}
                    </Button>
                  </div>
                </div>
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded bg-card p-2 font-mono text-xs">
                  {entry.sql}
                </pre>
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  )
}

function ResultPanel({ result }: { result: SQLExecutionResult }) {
  const { t } = useI18n()
  const { showToast } = useUIStore()

  const copyRows = async (format: 'json' | 'tsv') => {
    if (result.kind !== 'rows') return
    const content =
      format === 'json'
        ? JSON.stringify(result.rows, null, 2)
        : [
            result.columns.join('\t'),
            ...result.rows.map((row) =>
              result.columns.map((column) => formatCellValue(row[column]).replace(/\t/g, ' ')).join('\t')
            )
          ].join('\n')

    try {
      await navigator.clipboard.writeText(content)
      showToast(t(format === 'json' ? 'sql.copiedJson' : 'sql.copiedTsv'), 'success')
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  if (result.kind === 'empty') {
    return (
      <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
        {result.message}
      </div>
    )
  }

  if (result.kind === 'mutation') {
    return (
      <div className="space-y-2 rounded-md border border-border bg-card p-3 text-sm">
        <div>{t('sql.affectedRows', { count: result.affectedRows })}</div>
        {result.insertId !== undefined && <div>{t('sql.insertId', { id: String(result.insertId) })}</div>}
        {result.warningStatus !== undefined && <div>{t('sql.warnings', { count: result.warningStatus })}</div>}
      </div>
    )
  }

  if (result.kind === 'batch') {
    return (
      <div className="space-y-2 rounded-md border border-border bg-card p-3 text-sm">
        <div>{t('sql.executedStatements', { count: result.statements })}</div>
        <div>{t('sql.totalAffected', { count: result.affectedRows })}</div>
        {result.details.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {result.details.map((detail, index) => (
              <li key={index}>{detail}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (result.kind === 'explain') {
    return <ExplainPanel result={result.result} />
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <span>{t('sql.rowCount', { count: result.rows.length.toLocaleString() })}</span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => copyRows('tsv')}>
            <ClipboardCopy className="h-4 w-4" /> {t('sql.copyTsv')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => copyRows('json')}>
            <ClipboardCopy className="h-4 w-4" /> {t('sql.copyJson')}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <THead>
            <Tr>
              {result.columns.map((column) => (
                <Th key={column}>{column}</Th>
              ))}
            </Tr>
          </THead>
          <TBody>
            {result.rows.map((row, index) => (
              <Tr key={index}>
                {result.columns.map((column) => (
                  <Td key={column} title={formatCellValue(row[column])} className="max-w-none whitespace-pre-wrap break-all align-top">
                    {formatCellValue(row[column])}
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  )
}

function ExplainPanel({ result }: { result: ExplainSQLResult }) {
  const { t } = useI18n()
  const { showToast } = useUIStore()

  const copyExplainJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(result.raw ?? result.rows, null, 2))
      showToast(t('sql.copiedJson'), 'success')
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">{t('sql.explainPlan')}</span>
          <span>{result.engine === 'postgres' ? 'PostgreSQL' : 'MySQL'}</span>
          {result.summary.map((metric) => (
            <span key={`${metric.label}:${metric.value}`} className="rounded border border-border bg-background px-2 py-0.5">
              {metric.label}: {String(metric.value)}
            </span>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={copyExplainJson}>
          <ClipboardCopy className="h-4 w-4" /> {t('sql.copyJson')}
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-3 lg:grid-cols-[minmax(20rem,0.9fr)_minmax(26rem,1.1fr)]">
        <section className="min-h-0 overflow-auto rounded-md border border-border bg-background p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">{t('sql.visualPlan')}</div>
          {result.plan ? (
            <PlanNodeView node={result.plan} />
          ) : (
            <div className="text-sm text-muted-foreground">{t('sql.noVisualPlan')}</div>
          )}
        </section>
        <section className="min-h-0 overflow-auto rounded-md border border-border bg-background">
          <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
            {t('sql.rawExplainRows')}
          </div>
          {result.rows.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">{t('sql.noRows')}</div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  {result.columns.map((column) => (
                    <Th key={column}>{column}</Th>
                  ))}
                </Tr>
              </THead>
              <TBody>
                {result.rows.map((row, index) => (
                  <Tr key={index}>
                    {result.columns.map((column) => (
                      <Td key={column} title={formatCellValue(row[column])} className="max-w-none whitespace-pre-wrap break-all align-top">
                        {formatCellValue(row[column])}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </section>
      </div>
    </div>
  )
}

function PlanNodeView({ node, depth = 0 }: { node: ExplainPlanNode; depth?: number }) {
  return (
    <div className="relative">
      <div
        className="mb-2 rounded-md border border-border bg-card p-2"
        style={{ marginLeft: depth === 0 ? 0 : 14 }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-medium">{node.label}</div>
          {node.detail && <div className="text-xs text-muted-foreground">{node.detail}</div>}
        </div>
        {node.metrics.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
            {node.metrics.map((metric) => (
              <span key={`${node.id}:${metric.label}`} className="rounded border border-border bg-background px-2 py-0.5">
                {metric.label}: {String(metric.value)}
              </span>
            ))}
          </div>
        )}
      </div>
      {node.children.map((child) => (
        <PlanNodeView key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

function normalizeResult(raw: unknown, t: Translator): SQLExecutionResult {
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      return { kind: 'empty', message: t('sql.statementSuccess') }
    }

    if (raw.every((item) => isMutationPayload(item))) {
      const results = raw as Array<Record<string, unknown>>
      return {
        kind: 'batch',
        statements: results.length,
        affectedRows: results.reduce((sum, item) => sum + Number(item.affectedRows ?? 0), 0),
        details: results.map((item, index) => {
          const affectedRows = Number(item.affectedRows ?? 0)
          const insertId = item.insertId
          return insertId !== undefined && insertId !== 0
            ? t('sql.statementDetailWithInsertId', {
                index: index + 1,
                count: affectedRows,
                id: String(insertId)
              })
            : t('sql.statementDetail', { index: index + 1, count: affectedRows })
        })
      }
    }

    if (raw.every((item) => Array.isArray(item))) {
      const firstResultSet = raw[0] as Record<string, unknown>[]
      const columns = Array.from(new Set(firstResultSet.flatMap((row) => Object.keys(row))))
      return { kind: 'rows', columns, rows: firstResultSet }
    }

    const rows = raw as Record<string, unknown>[]
    const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
    return { kind: 'rows', columns, rows }
  }

  if (raw && typeof raw === 'object') {
    const payload = raw as Record<string, unknown>
    if (Array.isArray(payload.rows)) {
      const rows = payload.rows as Record<string, unknown>[]
      const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
      return rows.length > 0
        ? { kind: 'rows', columns, rows }
        : { kind: 'empty', message: t('sql.statementSuccess') }
    }
    if (typeof payload.affectedRows === 'number') {
      return {
        kind: 'mutation',
        affectedRows: payload.affectedRows,
        insertId: payload.insertId as number | string | undefined,
        warningStatus: payload.warningStatus as number | undefined
      }
    }
  }

  return { kind: 'empty', message: t('sql.statementSuccess') }
}

function isMutationPayload(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && typeof (value as Record<string, unknown>).affectedRows === 'number'
}
