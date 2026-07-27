// SQL console (blueprint §3.4).
//
// The six-button header band is one `Toolbar` (History + Run, everything else
// behind `⋯`), and the hand-rolled grid split — which had a `role="separator"`
// with no keyboard support at all — is the shared `SplitPane direction="vertical"`,
// keeping the `mysql-compare:sql-editor-percent` storage key and the 42%
// double-click reset. `⌘J` folds the results pane to the divider.
//
// Result rendering lives in `SQLResultPanel` / `SQLExplainPanel`, and the
// driver-shape normalisation in `sql-result-normalize.ts`.
import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import {
  ClipboardCopy,
  FileCode2,
  FolderOpen,
  History,
  PanelBottom,
  Play,
  RotateCcw,
  Rows3,
  ScanSearch,
  Trash2
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import type { MenuItem } from '@renderer/components/ui/dropdown-menu'
import { Kbd } from '@renderer/components/ui/kbd'
import { SplitPane } from '@renderer/components/ui/split-pane'
import { Toolbar } from '@renderer/components/ui/toolbar'
import { api, unwrap } from '@renderer/lib/api'
import { useAppAction } from '@renderer/lib/app-actions'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import { useTheme } from '@renderer/theme'
import type { DbEngine } from '../../../shared/types'
import { SQLResultPanel } from './SQLResultPanel'
import {
  normalizeResult,
  serializeRows,
  type CopyFormat,
  type SQLExecutionResult
} from './sql-result-normalize'

interface Props {
  connectionId: string
  connectionName?: string
  database: string
  engine?: DbEngine
  /**
   * The workspace keeps background tabs mounted, so an inactive console must
   * not answer ⌘J for the visible one.
   */
  active?: boolean
}

interface SQLHistoryEntry {
  id: string
  sql: string
  ranAt: number
}

const SQL_EDITOR_SIZE_STORAGE_KEY = 'mysql-compare:sql-editor-percent'
const DEFAULT_EDITOR_RATIO = 0.42
const MIN_PANE_PX = 140
const MAX_SQL_HISTORY = 20

/**
 * The storage key predates `SplitPane` and held a *percent* (`42`), which
 * `SplitPane` reads as an out-of-range ratio and silently discards. Rewrite it
 * once so an existing user keeps the split they chose.
 */
export function migrateStoredEditorRatio(): void {
  if (typeof localStorage === 'undefined') return
  const raw = localStorage.getItem(SQL_EDITOR_SIZE_STORAGE_KEY)
  if (raw == null) return
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 1) return
  const ratio = Math.min(0.75, Math.max(0.25, parsed / 100))
  localStorage.setItem(SQL_EDITOR_SIZE_STORAGE_KEY, String(ratio))
}

migrateStoredEditorRatio()

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
    window.localStorage.setItem(
      getHistoryStorageKey(connectionId, database),
      JSON.stringify(history)
    )
  } catch {
    /* ignore */
  }
}

export function SQLQueryView({
  connectionId,
  connectionName,
  database,
  engine,
  active = true
}: Props) {
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
  const [resultsCollapsed, setResultsCollapsed] = useState(false)
  const [history, setHistory] = useState<SQLHistoryEntry[]>(() =>
    readSQLHistory(connectionId, database)
  )
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const runSQLRef = useRef<(statementOverride?: string) => Promise<void>>(async () => undefined)
  const runSelectionRef = useRef<() => void>(() => undefined)

  const endpoint = connectionName ? `${connectionName} / ${database}` : database
  const canExplain = engine === 'mysql' || engine === 'postgres' || engine === undefined

  useEffect(() => {
    setHistory(readSQLHistory(connectionId, database))
  }, [connectionId, database])

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
    // A run always has something to say — never leave the results folded away.
    setResultsCollapsed(false)
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

  const runSelection = () => {
    if (!selectedSQL) {
      showToast(t('sql.runSelectedDisabled'), 'error')
      return
    }
    void runSQL(selectedSQL)
  }

  runSQLRef.current = runSQL
  runSelectionRef.current = runSelection

  const onEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    editor.onDidChangeCursorSelection(() => {
      syncSelectedSQL()
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      void runSQLRef.current()
    })
    // ⌘⇧↵ — the overflow menu's "Run selection" from the keyboard.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
      runSelectionRef.current()
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
    setResultsCollapsed(false)
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

  const copyRows = async (format: CopyFormat) => {
    if (result?.kind !== 'rows') return
    try {
      await navigator.clipboard.writeText(serializeRows(result.columns, result.rows, format))
      showToast(t(format === 'json' ? 'sql.copiedJson' : 'sql.copiedTsv'), 'success')
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  const copyExplainJson = async () => {
    if (result?.kind !== 'explain') return
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(result.result.raw ?? result.result.rows, null, 2)
      )
      showToast(t('sql.copiedJson'), 'success')
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  const clearHistory = () => {
    setHistory([])
    writeSQLHistory(connectionId, database, [])
  }

  const toggleResults = useCallback(() => setResultsCollapsed((value) => !value), [])

  useAppAction('toggle-bottom-panel', active ? toggleResults : null)

  const hasRows = result?.kind === 'rows'

  // Rebuilt every render on purpose: every item's enablement reads live state
  // (`running`, `selectedSQL`, the current result kind), and a memo keyed on all
  // of them would only add a stale-closure hazard.
  const overflowItems: MenuItem[] = [
    {
      id: 'run-selection',
      label: t('sql.runSelected'),
      icon: Rows3,
      shortcut: 'Mod+Shift+Enter',
      disabled: running || !selectedSQL,
      disabledReason: t('sql.runSelectedDisabled'),
      onSelect: runSelection
    },
    {
      id: 'explain',
      label: t('sql.explain'),
      icon: ScanSearch,
      disabled: running || !canExplain,
      disabledReason: canExplain ? t('sql.running') : t('sql.explainUnavailable'),
      onSelect: () => void runExplain()
    },
    {
      id: 'open-file',
      label: t('sql.openFile'),
      icon: FolderOpen,
      disabled: running,
      onSelect: () => fileInputRef.current?.click()
    },
    {
      id: 'reset',
      label: t('sql.reset'),
      icon: RotateCcw,
      disabled: running,
      onSelect: () => setSQL(t('sql.placeholder'))
    },
    {
      id: 'toggle-results',
      label: resultsCollapsed ? t('sql.showResults') : t('sql.hideResults'),
      icon: PanelBottom,
      shortcut: 'Mod+J',
      onSelect: toggleResults
    },
    { kind: 'separator', id: 'sep-copy' },
    {
      id: 'copy-tsv',
      label: t('sql.copyResultsTsv'),
      icon: ClipboardCopy,
      disabled: !hasRows,
      disabledReason: t('sql.noRowsToCopy'),
      onSelect: () => void copyRows('tsv')
    },
    {
      id: 'copy-json',
      label: t('sql.copyResultsJson'),
      icon: ClipboardCopy,
      disabled: !hasRows,
      disabledReason: t('sql.noRowsToCopy'),
      onSelect: () => void copyRows('json')
    },
    {
      id: 'clear-history',
      label: t('sql.clearHistory'),
      icon: Trash2,
      danger: true,
      disabled: history.length === 0,
      disabledReason: t('sql.historyEmpty'),
      onSelect: clearHistory
    }
  ]

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <Toolbar
        icon={FileCode2}
        title={t('sql.consoleTitle')}
        subtitle={`${endpoint}${engine ? ` · ${engine}` : ''}`}
        // What ⌘⇧↵ will run must not be the first thing a narrow window drops.
        subtitleSlot={
          selectedSQL
            ? t('sql.selectionActive', { count: selectedSQL.length })
            : t('sql.dropFileHint')
        }
        overflow={overflowItems}
        overflowLabel={t('common.moreActions')}
        progress={running ? { status: 'running', label: t('sql.running') } : null}
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              icon={History}
              onClick={() => setHistoryOpen(true)}
              disabled={history.length === 0}
            >
              {t('sql.history')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={Play}
              loading={running}
              aria-keyshortcuts="Meta+Enter"
              onClick={() => void runSQL()}
            >
              {running ? t('sql.running') : t('sql.run')}
              <Kbd className="border-accent-fg/30 bg-accent-fg/15 text-accent-fg">Mod+Enter</Kbd>
            </Button>
          </>
        }
      />

      <SplitPane
        direction="vertical"
        className="flex-1"
        label={t('sql.resizeEditor')}
        storageKey={SQL_EDITOR_SIZE_STORAGE_KEY}
        defaultRatio={DEFAULT_EDITOR_RATIO}
        min={MIN_PANE_PX}
        collapsible="second"
        collapsed={resultsCollapsed}
        onCollapsedChange={(next) => setResultsCollapsed(next)}
        collapsedSize={0}
      >
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col p-2 transition-colors',
            dragging && 'bg-accent-quiet'
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
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
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
        </div>

        {/* `auto` so the Panel states can scroll; the rows/explain panels are
            `h-full` and own their own scrolling. */}
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <SQLResultPanel
            result={result}
            error={error}
            running={running}
            subtitle={endpoint}
            onRun={() => void runSQL()}
            onCopyRows={(format) => void copyRows(format)}
            onCopyExplainJson={() => void copyExplainJson()}
          />
        </div>
      </SplitPane>

      {historyOpen ? (
        <Dialog
          open
          onOpenChange={setHistoryOpen}
          title={t('sql.history')}
          description={t('sql.historyDescription')}
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={clearHistory} disabled={history.length === 0}>
                {t('sql.clearHistory')}
              </Button>
              <Button variant="primary" onClick={() => setHistoryOpen(false)}>
                {t('common.close')}
              </Button>
            </>
          }
        >
          <div className="max-h-[60vh] space-y-2 overflow-auto">
            {history.map((entry) => (
              <div key={entry.id} className="rounded-md border border-border bg-canvas p-2">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-fg-muted">
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
                      variant="secondary"
                      icon={Play}
                      onClick={() => {
                        setHistoryOpen(false)
                        void runSQL(entry.sql)
                      }}
                    >
                      {t('sql.run')}
                    </Button>
                  </div>
                </div>
                <pre className="max-h-28 overflow-auto rounded bg-surface p-2 font-mono text-xs whitespace-pre-wrap">
                  {entry.sql}
                </pre>
              </div>
            ))}
          </div>
        </Dialog>
      ) : null}
    </div>
  )
}
