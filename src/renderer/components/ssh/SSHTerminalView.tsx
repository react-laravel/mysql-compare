import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTermTerminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { api, unwrap } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import { useTheme, type Theme } from '@renderer/theme'

const TERMINAL_THEMES = {
  dark: {
    background: '#09090b',
    foreground: '#f4f4f5',
    cursor: '#f4f4f5',
    selectionBackground: '#3f3f46'
  },
  light: {
    background: '#ffffff',
    foreground: '#18181b',
    cursor: '#18181b',
    selectionBackground: '#d4d4d8'
  }
} satisfies Record<Theme, NonNullable<ConstructorParameters<typeof XTermTerminal>[0]>['theme']>

interface SSHTerminalViewProps {
  connectionId: string
  connectionName: string
  active: boolean
}

export function SSHTerminalView({ connectionId, connectionName, active }: SSHTerminalViewProps) {
  const { t } = useI18n()
  const { theme } = useTheme()
  const initialThemeRef = useRef(theme)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<XTermTerminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const fitAndResizeRef = useRef<(() => void) | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const terminal = new XTermTerminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 5000,
      theme: TERMINAL_THEMES[initialThemeRef.current]
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
  }, [connectionId, connectionName, t])

  useEffect(() => {
    const terminal = terminalRef.current
    if (terminal) terminal.options.theme = TERMINAL_THEMES[theme]
  }, [theme])

  useEffect(() => {
    if (!active) return

    const handle = window.requestAnimationFrame(() => {
      fitAndResizeRef.current?.()
      terminalRef.current?.focus()
    })

    return () => window.cancelAnimationFrame(handle)
  }, [active])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 items-center justify-between border-b border-border bg-card px-3 text-xs text-muted-foreground">
        <div className="min-w-0 truncate">
          {t('sshTerminal.title')} · {connectionName}
        </div>
        <div className={cn('rounded-full px-2 py-0.5', statusClassName(status))}>{t(`sshTerminal.status.${status}`)}</div>
      </div>
      <div className="min-h-0 flex-1 bg-background p-2">
        <div
          ref={containerRef}
          className="h-full min-h-0 w-full overflow-hidden rounded border border-border/60"
          style={{ backgroundColor: TERMINAL_THEMES[theme].background }}
        />
      </div>
    </div>
  )
}

function statusClassName(status: 'connecting' | 'connected' | 'closed' | 'error'): string {
  if (status === 'connected') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  if (status === 'error') return 'bg-destructive/15 text-destructive'
  if (status === 'closed') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
  return 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
}
