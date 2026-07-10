import { useEffect, useMemo, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { RefreshCw, Save } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { api, unwrap } from '@renderer/lib/api'
import { useI18n } from '@renderer/i18n'
import { useUIStore } from '@renderer/store/ui-store'
import { useTheme } from '@renderer/theme'

interface SSHFileEditorProps {
  connectionId: string
  connectionName: string
  remotePath: string
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  cpp: 'cpp',
  cc: 'cpp',
  c: 'c',
  h: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  sh: 'shell',
  bash: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  vue: 'html',
  svelte: 'html',
  dart: 'dart',
  lua: 'lua'
}

function languageOf(path: string): string {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  return EXT_TO_LANG[path.slice(dot + 1).toLowerCase()] || 'plaintext'
}

export function SSHFileEditor({ connectionId, connectionName, remotePath }: SSHFileEditorProps) {
  const { t } = useI18n()
  const { theme } = useTheme()
  const { registerTabCloseGuard, showToast } = useUIStore()
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const saveRef = useRef<() => Promise<void>>(async () => undefined)
  const tabId = useMemo(() => `ssh-editor:${connectionId}:${remotePath}`, [connectionId, remotePath])

  const dirty = content !== original
  const language = useMemo(() => languageOf(remotePath), [remotePath])
  const subtitle = useMemo(() => `${connectionName} / ${remotePath}`, [connectionName, remotePath])

  const loadFile = async (force = false) => {
    if (!force && content !== original && !confirm(t('sshEditor.confirmDiscard'))) {
      return
    }
    const requestId = requestSeq.current + 1
    requestSeq.current = requestId
    setLoading(true)
    setError(null)
    try {
      const result = await unwrap(api.ssh.readFile({ connectionId, remotePath }))
      if (requestSeq.current !== requestId) return
      setContent(result.content)
      setOriginal(result.content)
    } catch (nextError) {
      if (requestSeq.current !== requestId) return
      const message = (nextError as Error).message
      setError(message)
      showToast(message, 'error')
    } finally {
      if (requestSeq.current === requestId) setLoading(false)
    }
  }

  useEffect(() => {
    void loadFile(true)
  }, [connectionId, remotePath])

  useEffect(() => {
    return registerTabCloseGuard(tabId, () => {
      if (content === original) return true
      return confirm(t('sshEditor.confirmDiscard'))
    })
  }, [content, original, registerTabCloseGuard, tabId, t])

  const saveFile = async () => {
    if (saving || !dirty) return
    setSaving(true)
    setError(null)
    try {
      await unwrap(api.ssh.writeFile({ connectionId, remotePath, content }))
      setOriginal(content)
      showToast(t('sshEditor.toast.saved', { path: remotePath }), 'success')
    } catch (nextError) {
      const message = (nextError as Error).message
      setError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  saveRef.current = saveFile

  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveRef.current()
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="border-b border-border bg-card px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{t('sshEditor.title')}</div>
            <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground">{dirty ? t('sshEditor.unsaved') : t('sshEditor.saved')}</div>
            <Button size="sm" variant="outline" onClick={() => void loadFile()} disabled={loading || saving}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              {t('common.refresh')}
            </Button>
            <Button size="sm" onClick={() => void saveFile()} disabled={loading || saving || !dirty}>
              <Save className="mr-1 h-3.5 w-3.5" />
              {saving ? t('sshEditor.saving') : t('sshEditor.save')}
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive dark:text-red-300">{error}</div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <Editor
          key={`${connectionId}:${remotePath}`}
          height="100%"
          path={`${connectionId}:${remotePath}`}
          language={language}
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          loading={t('sshEditor.loadingAssets')}
          value={content}
          onChange={(value) => setContent(value ?? '')}
          onMount={onMount}
          options={{
            readOnly: loading || saving,
            minimap: { enabled: true },
            fontSize: 13,
            wordWrap: 'on',
            automaticLayout: true,
            smoothScrolling: true,
          }}
        />
      </div>
    </div>
  )
}
