// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutableRefObject } from 'react'
import { TableDataGrid } from './TableDataGrid'
import { createQueryRowsResult, setEnglishLocale, testColumns, testRows } from './table-data-test-helpers'

afterEach(cleanup)

function createProps(overrides: Partial<React.ComponentProps<typeof TableDataGrid>> = {}) {
  return {
    data: createQueryRowsResult(),
    loading: false,
    visibleColumns: testColumns,
    orderBy: undefined,
    density: 'compact' as const,
    wrapCells: false,
    selected: new Set<number>(),
    allRowsOnPageSelected: false,
    someRowsOnPageSelected: false,
    selectionShiftPressedRef: { current: false } as MutableRefObject<boolean>,
    onToggleSelectPage: vi.fn(),
    onSort: vi.fn(),
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

  it('shows loading and empty states', () => {
    const { rerender } = render(<TableDataGrid {...createProps({ data: null, loading: true })} />)
    expect(screen.getByText('Loading...')).toBeTruthy()

    rerender(
      <TableDataGrid
        {...createProps({
          data: createQueryRowsResult({ rows: [], total: 0 }),
          loading: false
        })}
      />
    )

    expect(screen.getByText('No rows matched the current query.')).toBeTruthy()
  })

  it('wires sort, row selection, and edit interactions', () => {
    const props = createProps({
      orderBy: { column: 'name', dir: 'ASC' },
      selected: new Set([0]),
      someRowsOnPageSelected: true
    })

    render(<TableDataGrid {...props} />)

    expect(screen.getByText('name').parentElement?.className).toContain('whitespace-nowrap')
    expect(screen.getByText('▲').parentElement).toBe(screen.getByText('name').parentElement)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select rows on this page' }))
    fireEvent.click(screen.getByText('name'))
    fireEvent.click(screen.getByText('Alice'))
    fireEvent.doubleClick(screen.getByText('Alice'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 1' }), { shiftKey: true })

    expect(screen.getAllByText('✓')).toHaveLength(2)
    expect(props.onToggleSelectPage).toHaveBeenCalledTimes(1)
    expect(props.onSort).toHaveBeenCalledWith('name')
    expect(props.onRowClick).toHaveBeenCalledWith(0, false)
    expect(props.onStartEdit).toHaveBeenCalledWith(testRows[0])
    expect(props.onToggleSelect).toHaveBeenCalledWith(0, true)
  })

  it('offers INSERT copies with and without the ID from the row context menu', () => {
    const onCopyInsert = vi.fn()
    render(<TableDataGrid {...createProps({ onCopyInsert })} />)

    fireEvent.contextMenu(screen.getByText('Alice'), { clientX: 120, clientY: 160 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy as INSERT (with ID)' }))
    expect(onCopyInsert).toHaveBeenLastCalledWith(testRows[0], true)

    fireEvent.contextMenu(screen.getByText('Alice'), { clientX: 120, clientY: 160 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy as INSERT (without ID)' }))
    expect(onCopyInsert).toHaveBeenLastCalledWith(testRows[0], false)
  })
})
