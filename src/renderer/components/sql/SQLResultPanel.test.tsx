// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { SQLResultPanel } from './SQLResultPanel'

beforeEach(() => useI18nStore.getState().setLocale('en'))
afterEach(cleanup)

describe('SQL result previews', () => {
  it('keeps long values bounded until the user opens the full cell', () => {
    const value = 'x'.repeat(20_000) + 'secret-at-end'
    const { container } = render(<SQLResultPanel result={{ kind: 'rows', columns: ['body'], rows: [{ body: value }] }} error={null} running={false} subtitle="test" onRun={vi.fn()} onCopyRows={vi.fn()} onCopyExplainJson={vi.fn()} />)
    const cell = container.querySelector('tbody td button')!
    expect(cell.textContent?.length).toBe(500)
    expect(container.querySelector('tbody td')?.getAttribute('title')?.length).toBe(1024)
    expect(screen.queryByText(value)).toBeNull()
    act(() => (cell as HTMLElement).focus())
    fireEvent.click(cell)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(value)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(cell)
  })
})
