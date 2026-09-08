// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import type { AppAPI } from '../../../shared/app-api'
import type { SyncProgressEvent } from '../../../shared/types'
import { SyncPanel } from './SyncPanel'

const buildPlan = vi.fn()
const execute = vi.fn()
let progress: (event: SyncProgressEvent) => void
const props = {
  open: true, onClose: vi.fn(), source: { connectionId: 's', database: 'app' }, target: { connectionId: 't', database: 'app' },
  sourceEngine: 'mysql' as const, targetEngine: 'mysql' as const,
  diff: { sourceDatabase: 'app', targetDatabase: 'app', tableDiffs: [{ table: 'items', kind: 'modified' as const, columnDiffs: [], indexDiffs: [] }], rowComparisons: [] }
}
const plan = { ok: true, data: { planId: 'verified-plan', steps: [{ table: 'items', description: 'preview', sqls: ['SELECT 1'] }] } }
afterEach(cleanup)
beforeEach(() => {
  useI18nStore.getState().setLocale('en')
  buildPlan.mockReset().mockResolvedValue(plan)
  execute.mockReset().mockResolvedValue({ ok: true, data: { executed: 1, errors: 0 } })
  ;(window as unknown as { api: AppAPI }).api = { sync: { buildPlan, execute, onProgress: (listener: typeof progress) => { progress = listener; return () => {} } } } as unknown as AppAPI
})

describe('sync preview binding', () => {
  it('invalidates a preview as soon as a strategy changes', async () => {
    render(<SyncPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview SQL' }))
    await screen.findByText(/SELECT 1/)
    expect(screen.getByRole('button', { name: 'Execute' }).hasAttribute('disabled')).toBe(false)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'truncate-and-import' } })
    expect(screen.getByRole('button', { name: 'Execute' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText(/SELECT 1/)).toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  it('ignores a stale preview response after the selected tables change', async () => {
    let resolve!: (value: typeof plan) => void
    buildPlan.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    render(<SyncPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview SQL' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'items' }))
    await act(async () => resolve(plan))
    expect(screen.queryByText(/SELECT 1/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Execute' }).hasAttribute('disabled')).toBe(true)
  })

  it('executes the preview snapshot and ignores unrelated progress', async () => {
    render(<SyncPanel {...props} />)
    act(() => progress({ taskId: 'unrelated', table: 'unrelated-table', step: 'start', done: 0, total: 1, level: 'info' }))
    expect(screen.queryByText(/unrelated-table/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Preview SQL' }))
    await screen.findByText(/SELECT 1/)
    fireEvent.click(screen.getByRole('button', { name: 'Execute' }))
    const buttons = await screen.findAllByRole('button', { name: 'Execute' })
    fireEvent.click(buttons[buttons.length - 1]!)
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect(execute.mock.calls[0]![0]).toMatchObject({ planId: 'verified-plan', tables: ['items'], existingTableStrategy: 'skip', dryRun: false })
    expect(execute.mock.calls[0]![0].taskId).toBeTruthy()
  })
})
