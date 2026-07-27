// SSH 终端（blueprint §3.7）。
//
// 头部是共享 `Toolbar`：title/subtitle + 状态 `Badge`（走 §7 的统一状态词汇，
// 旧的 `statusClassName()` 已删）+ 一个 `⋯`（重连 / 清屏 / 复制全部）。
import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTermTerminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { Copy, Eraser, RefreshCw, SquareTerminal } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Badge } from '@renderer/components/ui/badge'
import { STATUS_ICON } from '@renderer/components/ui/status-dot'
import { Toolbar } from '@renderer/components/ui/toolbar'
import type { MenuItem } from '@renderer/components/ui/dropdown-menu'
import type { JobStatus } from '@renderer/components/ui/progress-bar'
import type { Tone } from '@renderer/components/ui/badge'
import { useI18n } from '@renderer/i18n'
import { useUIStore } from '@renderer/store/ui-store'
import { useTheme } from '@renderer/theme'

type XTermTheme = NonNullable<ConstructorParameters<typeof XTermTerminal>[0]>['theme']

/**
 * xterm paints on a canvas, so it cannot use CSS variables — it needs literal
 * colours. Rather than keep a second, drifting palette (the old one was zinc,
 * the app is slate), read the tokens once per theme change, the same way
 * DESIGN-SYSTEM §1.6 has charts do it. Missing values fall through to xterm's
 * own defaults instead of a hardcoded hex.
 */
function readTerminalTheme(): XTermTheme {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return {}
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string): string | undefined => styles.getPropertyValue(name).trim() || undefined
  const foreground = read('--ds-fg')

  return {
    background: read('--ds-canvas'),
    foreground,
    cursor: foreground,
    selectionBackground: read('--ds-border-strong')
  }
}

interface SSHTerminalViewProps {
  connectionId: string
  connectionName: string
  active: boolean
}

export function SSHTerminalView({ connectionId, connectionName, active }: SSHTerminalViewProps) {
  const { t } = useI18n()
  const { theme } = useTheme()
  const showToast = useUIStore((state) => state.showToast)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<XTermTerminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const fitAndResizeRef = useRef<(() => void) | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [status, setStatus] = useState<TerminalStatus>('connecting')
  // 重连 = 重跑整个 effect：清理函数已经负责关会话和销毁 xterm 实例。
  const [reconnectToken, setReconnectToken] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    setStatus('connecting')
    const terminal = new XTermTerminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 5000,
      theme: readTerminalTheme()
    })
    const fitAddon = new FitAddon()

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    fitAddon.fit()
    terminal.writeln(t('sshTerminal.connecting', { connection: connectionName }))

    const writeDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current
      if (!sessionId) return
      void api.ssh.writeTerminal({ sessionId, data })
    })

    const fitAndResize = () => {
      if (container.clientWidth <= 0 || container.clientHeight <= 0) return
      fitAddon.fit()
      const sessionId = sessionIdRef.current
      if (!sessionId) return
      if (terminal.cols <= 0 || terminal.rows <= 0) return
      void api.ssh.resizeTerminal({
        sessionId,
        cols: terminal.cols,
        rows: terminal.rows
      })
    }
    fitAndResizeRef.current = fitAndResize

    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(fitAndResize, 40)
    })
    resizeObserver.observe(container)

    const offData = api.ssh.onTerminalData((event) => {
      if (event.sessionId !== sessionIdRef.current) return
      terminal.write(event.data)
    })

    const offExit = api.ssh.onTerminalExit((event) => {
      if (event.sessionId !== sessionIdRef.current) return
      setStatus(event.message ? 'error' : 'closed')
      terminal.writeln('')
      terminal.writeln(event.message ? t('sshTerminal.closedWithError', { message: event.message }) : t('sshTerminal.closed'))
      sessionIdRef.current = null
    })

    void unwrap(api.ssh.createTerminal({ connectionId, cols: terminal.cols, rows: terminal.rows }))
      .then((result) => {
        if (disposed) {
          void api.ssh.closeTerminal({ sessionId: result.sessionId })
          return
        }
        sessionIdRef.current = result.sessionId
        setStatus('connected')
        fitAndResize()
      })
      .catch((error) => {
        if (disposed) return
        setStatus('error')
        terminal.writeln(t('sshTerminal.failed', { message: (error as Error).message }))
      })

    return () => {
      disposed = true
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = null
      }
      const sessionId = sessionIdRef.current
      sessionIdRef.current = null
      if (sessionId) void api.ssh.closeTerminal({ sessionId })
      offData()
      offExit()
      resizeObserver.disconnect()
      writeDisposable.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      fitAndResizeRef.current = null
    }
  }, [connectionId, connectionName, reconnectToken, t])

  useEffect(() => {
    const terminal = terminalRef.current
    if (terminal) terminal.options.theme = readTerminalTheme()
  }, [theme])

  useEffect(() => {
    if (!active) return

    const handle = window.requestAnimationFrame(() => {
      fitAndResizeRef.current?.()
      terminalRef.current?.focus()
    })

    return () => window.cancelAnimationFrame(handle)
  }, [active])

  const clearTerminal = () => terminalRef.current?.clear()

  const copyAll = () => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.selectAll()
    const text = terminal.getSelection()
    terminal.clearSelection()
    if (!text) return
    void navigator.clipboard.writeText(text)
    showToast(t('sshTerminal.copied'), 'success')
  }

  const overflow: MenuItem[] = [
    {
      id: 'reconnect',
      icon: RefreshCw,
      label: t('sshTerminal.reconnect'),
      onSelect: () => setReconnectToken((value) => value + 1)
    },
    { id: 'clear', icon: Eraser, label: t('sshTerminal.clear'), onSelect: clearTerminal },
    { id: 'copy-all', icon: Copy, label: t('sshTerminal.copyAll'), onSelect: copyAll }
  ]

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <Toolbar
        icon={SquareTerminal}
        title={t('sshTerminal.title')}
        subtitle={connectionName}
        progress={status === 'connecting' ? { status: 'running', label: t('sshTerminal.status.connecting') } : null}
        overflowLabel={t('common.moreActions')}
        overflow={overflow}
        actions={
          <Badge tone={TERMINAL_STATUS_TONE[status]} icon={STATUS_ICON[TERMINAL_JOB_STATUS[status]]}>
            {t(`sshTerminal.status.${status}`)}
          </Badge>
        }
      />
      <div className="min-h-0 flex-1 bg-canvas p-2">
        <div
          ref={containerRef}
          className="h-full min-h-0 w-full overflow-hidden rounded-md border border-border bg-canvas"
        />
      </div>
    </div>
  )
}

/** The shared status vocabulary — one badge shape for every long-lived state. */
type TerminalStatus = 'connecting' | 'connected' | 'closed' | 'error'

const TERMINAL_JOB_STATUS: Record<TerminalStatus, JobStatus> = {
  connecting: 'running',
  connected: 'done',
  closed: 'cancelled',
  error: 'error'
}

const TERMINAL_STATUS_TONE: Record<TerminalStatus, Tone> = {
  connecting: 'running',
  connected: 'success',
  closed: 'warning',
  error: 'danger'
}
