// 远程文件编辑器（blueprint §3.7）。
//
// 头部是共享 `Toolbar`：脏标记 `Badge` + 常驻 Save（带 ⌘S）。两处
// `window.confirm`（重新载入 / 关闭标签页时丢弃改动）换成同一个
// `ConfirmDialog`。
import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, FileCode, RefreshCw, Save } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { ConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { Kbd } from '@renderer/components/ui/kbd'
import { MonacoEditor as Editor, type OnMount } from '@renderer/components/ui/monaco-editor'
import { Panel } from '@renderer/components/ui/panel'
import { Toolbar } from '@renderer/components/ui/toolbar'
import type { MenuItem } from '@renderer/components/ui/dropdown-menu'
import { api, unwrap } from '@renderer/lib/api'
import { useAppAction } from '@renderer/lib/app-actions'
import { useI18n } from '@renderer/i18n'
import { useUIStore } from '@renderer/store/ui-store'
import { useTheme } from '@renderer/theme'

interface SSHFileEditorProps {
  connectionId: string
  connectionName: string
  remotePath: string
  /** 后台标签页不能抢 ⌘S / ⌘R */
  active?: boolean
}

/** 丢弃未保存改动的两个入口：重新载入、关闭标签页。 */
type DiscardIntent = 'reload' | 'close'

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

export function SSHFileEditor({
  connectionId,
  connectionName,
  remotePath,
  active = true
}: SSHFileEditorProps) {
  const { t } = useI18n()
  const { theme } = useTheme()
  const { closeTab, registerTabCloseGuard, showToast } = useUIStore()
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discardIntent, setDiscardIntent] = useState<DiscardIntent | null>(null)
  const requestSeq = useRef(0)
  // 用户已经在确认框里点了"丢弃"，再问一次就成了死循环。
  const discardConfirmedRef = useRef(false)
  const saveRef = useRef<() => Promise<void>>(async () => undefined)
  const tabId = useMemo(() => `ssh-editor:${connectionId}:${remotePath}`, [connectionId, remotePath])

  const dirty = content !== original
  const language = useMemo(() => languageOf(remotePath), [remotePath])
  const subtitle = useMemo(() => `${connectionName} / ${remotePath}`, [connectionName, remotePath])
  const fileName = useMemo(() => remotePath.split('/').filter(Boolean).pop() || remotePath, [remotePath])

  const loadFile = async (force = false) => {
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

  const reloadFile = () => {
    if (dirty) {
      setDiscardIntent('reload')
      return
    }
    void loadFile(true)
  }

  useEffect(() => {
    return registerTabCloseGuard(tabId, (reason) => {
      if (content === original || discardConfirmedRef.current) return true
      // `check`（批量关闭 / 文件被移动）不允许弹框：提问的一方自己负责确认。
      if (reason === 'close') setDiscardIntent('close')
      return false
    })
  }, [content, original, registerTabCloseGuard, tabId])

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

  useAppAction('save', active && dirty && !saving ? () => void saveFile() : null)
  useAppAction('refresh-view', active && !loading && !saving ? reloadFile : null)

  const discardChanges = () => {
    const intent = discardIntent
    setDiscardIntent(null)
    if (intent === 'reload') {
      void loadFile(true)
      return
    }
    if (intent === 'close') {
      discardConfirmedRef.current = true
      closeTab(tabId)
    }
  }

  const overflow: MenuItem[] = [
    { id: 'reload', icon: RefreshCw, label: t('sshEditor.reload'), onSelect: reloadFile },
    {
      id: 'copy-path',
      icon: Copy,
      label: t('sshEditor.copyPath'),
      onSelect: () => {
        void navigator.clipboard.writeText(remotePath)
        showToast(t('sshEditor.pathCopied'), 'success')
      }
    }
  ]

  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveRef.current()
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas">
      <Toolbar
        icon={FileCode}
        title={<span className="font-mono">{fileName}</span>}
        subtitle={<span className="font-mono">{subtitle}</span>}
        progress={loading || saving ? { status: 'running', label: t('common.loading') } : null}
        overflowLabel={t('common.moreActions')}
        overflow={overflow}
        actions={
          <>
            <Badge tone={dirty ? 'warning' : 'idle'}>
              {dirty ? t('sshEditor.unsaved') : t('sshEditor.saved')}
            </Badge>
            <Button
              size="sm"
              variant="primary"
              icon={Save}
              loading={saving}
              aria-keyshortcuts="Meta+S"
              disabled={loading || saving || !dirty}
              onClick={() => void saveFile()}
            >
              {saving ? t('sshEditor.saving') : t('sshEditor.save')}
              <Kbd className="border-accent-fg/30 bg-accent-fg/15 text-accent-fg">Mod+S</Kbd>
            </Button>
          </>
        }
      />

      {error && (
        <Panel tone="danger" className="m-2" padded>
          <p className="text-sm text-danger-text">{error}</p>
        </Panel>
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

      <ConfirmDialog
        open={discardIntent !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardIntent(null)
        }}
        tone="danger"
        title={t('sshEditor.confirmDiscardTitle')}
        subject={remotePath}
        body={t('sshEditor.confirmDiscardBody')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('sshEditor.discardChanges')}
        onConfirm={discardChanges}
      />
    </div>
  )
}
