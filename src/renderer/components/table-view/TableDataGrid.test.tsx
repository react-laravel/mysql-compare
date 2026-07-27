// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TableDataGrid } from './TableDataGrid'
import { createQueryRowsResult, setEnglishLocale, testColumns, testRows } from './table-data-test-helpers'

afterEach(cleanup)

function createProps(overrides: Partial<React.ComponentProps<typeof TableDataGrid>> = {}) {
  return {
    data: createQueryRowsResult(),
    visibleColumns: testColumns,
    orderBy: undefined,
    density: 'compact' as const,
    wrapCells: false,
    selected: new Set<number>(),
    onSort: vi.fn(),
    onToggleSelectPage: vi.fn(),
    onRowClick: vi.fn(),
    onStartEdit: vi.fn(),
    onToggleSelect: vi.fn(),
    ...overrides
  }
}

describe('TableDataGrid', () => {
  beforeEach(() => {
    setEnglishLocale()
  })

  // DS §7.6: the bare "no rows" string became an EmptyState with an action.
  it('offers a way out of every empty state', () => {
    const onInsert = vi.fn()
    const onClearFilter = vi.fn()

    const { rerender } = render(
      <TableDataGrid
        {...createProps({
          data: createQueryRowsResult({ rows: [], total: 0 }),
          onInsert
        })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(onInsert).toHaveBeenCalledTimes(1)

    rerender(
      <TableDataGrid
        {...createProps({
          data: createQueryRowsResult({ rows: [], total: 0 }),
          hasActiveFilter: true,
          activeFilter: "name = 'x'",
          onClearFilter
        })}
      />
    )
    expect(screen.getByText("name = 'x'")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(onClearFilter).toHaveBeenCalledTimes(1)
  })

  it('renders a retryable error state instead of an empty grid', () => {
    const onRetry = vi.fn()
    render(<TableDataGrid {...createProps({ data: null, error: new Error('boom'), onRetry })} />)

    expect(screen.getByText('Could not load rows')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('wires sort, row selection, and edit interactions', () => {
    const props = createProps({
      orderBy: { column: 'name', dir: 'ASC' },
      selected: new Set([0])
    })

    render(<TableDataGrid {...props} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select rows on this page' }))
    expect(props.onToggleSelectPage).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /name/ }))
    expect(props.onSort).toHaveBeenCalledWith('name')

    fireEvent.click(screen.getByText('Alice'))
    expect(props.onRowClick).toHaveBeenCalledWith(0, false)

    fireEvent.doubleClick(screen.getByText('Alice'))
    expect(props.onStartEdit).toHaveBeenCalledWith(testRows[0])

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 1' }), { shiftKey: true })
    expect(props.onToggleSelect).toHaveBeenCalledWith(0, true)
  })

  // The old grid was mouse-only; Enter on a focused row now opens the editor.
  it('opens the row editor from the keyboard', () => {
    const props = createProps()
    render(<TableDataGrid {...props} />)

    const row = screen.getByText('Alice').closest('tr')
    expect(row).toBeTruthy()
    fireEvent.keyDown(row!, { key: 'Enter' })
    expect(props.onStartEdit).toHaveBeenCalledWith(testRows[0])
  })

  it('offers INSERT copies, edit and delete from the row context menu', () => {
    const onCopyInsert = vi.fn()
    const onDeleteRows = vi.fn()
    render(<TableDataGrid {...createProps({ onCopyInsert, onDeleteRows })} />)

    fireEvent.contextMenu(screen.getByText('Alice'), { clientX: 120, clientY: 160 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy as INSERT (with ID)' }))
    expect(onCopyInsert).toHaveBeenLastCalledWith(testRows[0], true)

    fireEvent.contextMenu(screen.getByText('Alice'), { clientX: 120, clientY: 160 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy as INSERT (without ID)' }))
    expect(onCopyInsert).toHaveBeenLastCalledWith(testRows[0], false)

    fireEvent.contextMenu(screen.getByText('Alice'), { clientX: 120, clientY: 160 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete row' }))
    expect(onDeleteRows).toHaveBeenLastCalledWith([0])
  })
})
