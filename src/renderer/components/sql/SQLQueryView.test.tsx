// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { resetAppActions, runAppAction } from '@renderer/lib/app-actions'
import type { AppAPI } from '../../../shared/app-api'
import { migrateStoredEditorRatio, SQLQueryView } from './SQLQueryView'

// Monaco needs a real worker + layout engine; the console's behaviour under
// test is the toolbar, the split and the result states, not the editor itself.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <textarea readOnly data-testid="editor" value={value} />
}))

const executeSQL = vi.fn()

function installApi(): void {
  ;(window as unknown as { api: AppAPI }).api = {
    db: { executeSQL }
  } as unknown as AppAPI
}

function renderConsole(overrides: Partial<React.ComponentProps<typeof SQLQueryView>> = {}) {
  return render(
    <SQLQueryView
      connectionId="c1"
      connectionName="prod"
      database="shop"
      engine="mysql"
      {...overrides}
    />
  )
}

function openOverflow(): void {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
}

/** The toolbar's Run — the idle empty state renders a second one named `Run`. */
function toolbarRun(): HTMLElement {
  const button = document.querySelector<HTMLElement>('button[aria-keyshortcuts="Meta+Enter"]')
  if (!button) throw new Error('toolbar Run button not found')
  return button
}

afterEach(() => {
  cleanup()
  resetAppActions()
})

beforeEach(() => {
  useI18nStore.getState().setLocale('en')
  window.localStorage.clear()
  executeSQL.mockReset()
  installApi()
})

describe('SQLQueryView', () => {
  it('renders a toolbar carrying the endpoint and the two primary actions', () => {
    renderConsole()

    expect(screen.getByRole('heading', { name: 'SQL Console' })).toBeTruthy()
    // The endpoint truncates; the drop-file hint lives in the non-truncating
    // `Toolbar.subtitleSlot` beside it, so they are two elements now.
    expect(screen.getByText('prod / shop · mysql')).toBeTruthy()
    expect(screen.getByText(/Drag a SQL/)).toBeTruthy()
    expect(toolbarRun()).toBeTruthy()
    // History is disabled until something has been run — unchanged behaviour.
    expect(screen.getByRole('button', { name: 'History' }).hasAttribute('disabled')).toBe(true)
  })

  it('shows an idle empty state with Run as its action instead of a dashed box', () => {
    renderConsole()

    expect(screen.getByText('No results yet')).toBeTruthy()
    expect(screen.getByText('Run SQL against prod / shop to see results here.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy()
  })

  it('keeps every demoted control reachable from the overflow menu', () => {
    renderConsole()
    openOverflow()

    for (const label of [
      'Run selection',
      'Explain',
      'Open File',
      'Reset',
      'Hide results pane',
      'Copy results as TSV',
      'Copy results as JSON',
      'Clear history'
    ]) {
      expect(screen.getByRole('menuitem', { name: new RegExp(label) })).toBeTruthy()
    }
  })

  it('renders returned rows in a report table', async () => {
    executeSQL.mockResolvedValue({ ok: true, data: [{ id: 1, customer: 'ada' }] })
    renderConsole()

    fireEvent.click(toolbarRun())

    await waitFor(() => expect(screen.getByText('1 row(s)')).toBeTruthy())
    expect(screen.getByRole('columnheader', { name: 'customer' })).toBeTruthy()
    expect(screen.getByText('ada')).toBeTruthy()
  })

  it('renders a driver failure as a themed danger panel, not a red literal', async () => {
    executeSQL.mockResolvedValue({ ok: false, error: "Table 'shop.nope' doesn't exist\nat pool" })
    renderConsole()

    fireEvent.click(toolbarRun())

    await waitFor(() => expect(screen.getByText('Statement failed')).toBeTruthy())
    expect(screen.getByText("Table 'shop.nope' doesn't exist")).toBeTruthy()
    expect(screen.getByText('Full driver message')).toBeTruthy()
  })

  it('answers ⌘J only while it is the active tab', () => {
    const { rerender } = renderConsole({ active: false })
    expect(runAppAction('toggle-bottom-panel')).toBe(false)

    rerender(
      <SQLQueryView connectionId="c1" connectionName="prod" database="shop" engine="mysql" active />
    )
    expect(runAppAction('toggle-bottom-panel')).toBe(true)
  })

  it('folds the results pane to the divider and back through the overflow item', () => {
    const { container } = renderConsole()
    expect(screen.getByRole('separator', { name: 'Resize SQL editor' })).toBeTruthy()
    expect(container.querySelector('[style*="height: 0px"]')).toBeNull()

    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: /Hide results pane/ }))
    expect(container.querySelector('[style*="height: 0px"]')).not.toBeNull()

    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: /Show results pane/ }))
    expect(container.querySelector('[style*="height: 0px"]')).toBeNull()
  })

  it('migrates the legacy percent split ratio stored under the same key', () => {
    // The key predates `SplitPane`, which only accepts a 0..1 ratio.
    window.localStorage.setItem('mysql-compare:sql-editor-percent', '60')
    migrateStoredEditorRatio()
    expect(window.localStorage.getItem('mysql-compare:sql-editor-percent')).toBe('0.6')

    migrateStoredEditorRatio()
    expect(window.localStorage.getItem('mysql-compare:sql-editor-percent')).toBe('0.6')
  })
})
