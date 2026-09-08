// @vitest-environment jsdom
import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { OnMount } from '@monaco-editor/react'
import type { AppAPI } from '../../../shared/app-api'
import { useI18nStore } from '@renderer/i18n'
import { useUIStore } from '@renderer/store/ui-store'
import { SQLQueryView } from './SQLQueryView'

const editor = vi.hoisted(() => ({ commands: [] as Array<() => void> }))
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, onMount }: { value: string; onChange: (value: string) => void; onMount: OnMount }) => {
    useEffect(() => {
      onMount({ getSelection: () => null, getModel: () => null, onDidChangeCursorSelection: () => {}, addCommand: (_key: number, run: () => void) => editor.commands.push(run) } as unknown as Parameters<OnMount>[0],
        { KeyMod: { CtrlCmd: 1, Shift: 2 }, KeyCode: { Enter: 3 } } as unknown as Parameters<OnMount>[1])
    }, [])
    return <input aria-label="SQL draft" value={value} onChange={(event) => onChange(event.target.value)} />
  }
}))
const executeSQL = vi.fn()
beforeEach(() => {
  useI18nStore.getState().setLocale('en')
  useUIStore.setState({ workspaceTabs: [], activeTabId: null, rightView: { kind: 'empty' } })
  editor.commands = []
  executeSQL.mockReset().mockResolvedValue({ ok: true, data: { affectedRows: 1 } })
  ;(window as unknown as { api: AppAPI }).api = { db: { executeSQL } } as unknown as AppAPI
})
afterEach(cleanup)

async function consoleView() {
  render(<SQLQueryView connectionId="c1" database="shop" connectionName="prod" engine="mysql" />)
  const input = await screen.findByRole('textbox', { name: 'SQL draft' })
  fireEvent.change(input, { target: { value: 'UPDATE items SET value = 2' } })
  return input
}

it('serializes Monaco shortcut execution before React can disable the toolbar', async () => {
  let resolve!: (value: unknown) => void
  executeSQL.mockReturnValueOnce(new Promise((done) => { resolve = done }))
  await consoleView()
  act(() => { editor.commands[0]!(); editor.commands[0]!() })
  expect(executeSQL).toHaveBeenCalledTimes(1)
  await act(async () => resolve({ ok: true, data: { affectedRows: 1 } }))
  act(() => editor.commands[0]!())
  await waitFor(() => expect(executeSQL).toHaveBeenCalledTimes(2))
})

it('keeps an edited draft open until discard is confirmed', async () => {
  useUIStore.getState().setRightView({ kind: 'sql', connectionId: 'c1', database: 'shop', engine: 'mysql' })
  await consoleView()
  act(() => useUIStore.getState().closeTab('sql:c1:shop'))
  expect(useUIStore.getState().workspaceTabs).toHaveLength(1)
  fireEvent.click(await screen.findByRole('button', { name: 'Discard draft' }))
  await waitFor(() => expect(useUIStore.getState().workspaceTabs).toHaveLength(0))
})
