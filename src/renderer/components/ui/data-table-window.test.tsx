// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTable } from './data-table'

afterEach(cleanup)

const rows = Array.from({ length: 10_000 }, (_, id) => ({ id, value: `row-${id}` }))
const columns = [{ id: 'value', header: 'Value', cell: (row: typeof rows[number]) => row.value }]

describe('DataTable DOM window', () => {
  it('renders a bounded number of rows and reaches the last row on scroll', () => {
    const { container } = render(<DataTable rows={rows} columns={columns} rowKey={(row) => String(row.id)} virtualized={{ rowHeight: 28 }} />)
    expect(container.querySelectorAll('tbody tr[aria-rowindex]').length).toBeLessThan(40)
    expect(screen.queryByText('row-9999')).toBeNull()
    const viewport = container.firstElementChild as HTMLElement
    viewport.scrollTop = 280_000 - 480
    fireEvent.scroll(viewport)
    expect(screen.getByText('row-9999')).toBeTruthy()
    expect(container.querySelectorAll('tbody tr[aria-rowindex]').length).toBeLessThan(40)
    expect(screen.getByRole('table').getAttribute('aria-rowcount')).toBe('10001')
  })

  it('keeps focus alive outside the window and navigates across windows with End/Home', () => {
    const onActivate = vi.fn()
    const { container } = render(<DataTable rows={rows} columns={columns} rowKey={(row) => String(row.id)} virtualized={{ rowHeight: 28 }} onRowActivate={onActivate} />)
    const first = screen.getByText('row-0').closest('tr')!
    act(() => first.focus())
    const viewport = container.firstElementChild as HTMLElement
    viewport.scrollTop = 100_000
    fireEvent.scroll(viewport)
    expect(document.activeElement).toBe(first)
    expect(container.querySelectorAll('tbody tr[aria-rowindex]').length).toBeLessThan(45)
    fireEvent.keyDown(first, { key: 'End' })
    const last = screen.getByText('row-9999').closest('tr')!
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Enter' })
    expect(onActivate).toHaveBeenCalledWith(rows[9999], 9999)
    fireEvent.keyDown(last, { key: 'Home' })
    expect(document.activeElement).toBe(screen.getByText('row-0').closest('tr'))
  })

  it('selects every loaded row even when only a window is mounted', () => {
    const onChange = vi.fn()
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => String(row.id)} virtualized={{ rowHeight: 28 }} selection={{ selected: new Set(), onChange, selectAllLabel: 'Select all' }} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(onChange.mock.calls[0]?.[0].size).toBe(10_000)
  })
})
