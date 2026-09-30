// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TableDataToolbar } from './TableDataToolbar'
import { setEnglishLocale } from './table-data-test-helpers'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '@renderer/store/settings-store'

afterEach(cleanup)

function createProps(overrides: Partial<React.ComponentProps<typeof TableDataToolbar>> = {}) {
  return {
    table: 'users',
    database: 'app_db',
    connectionName: 'prod',
    engine: 'mysql',
    where: '',
    hasPendingWhere: false,
    hasActiveFilter: false,
    loading: false,
    selectedCount: 0,
    totalRows: 1284,
    hasPrimaryKey: true,
    wrapCells: false,
    density: 'compact' as const,
    pageSize: 100,
    columnCounts: undefined,
    onWhereChange: vi.fn(),
    onApplyWhere: vi.fn(),
    onClearWhere: vi.fn(),
    onRefresh: vi.fn(),
    onOpenExport: vi.fn(),
    onOpenColumnPanel: vi.fn(),
    onToggleWrapCells: vi.fn(),
    onSetDensity: vi.fn(),
    onPageSizeChange: vi.fn(),
    onInsert: vi.fn(),
    onDeleteSelected: vi.fn(),
    onCopySelectedRows: vi.fn(),
    onClearSelection: vi.fn(),
    ...overrides
  }
}

function openOverflow() {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
}

describe('TableDataToolbar', () => {
  beforeEach(() => {
    setEnglishLocale()
  })

  it('wires filter input changes and keyboard shortcuts', () => {
    const props = createProps({
      where: 'status = 1',
      hasPendingWhere: true,
      hasActiveFilter: true
    })

    render(<TableDataToolbar {...props} />)

    const input = screen.getByPlaceholderText(/WHERE clause, e\.g\./i)
    fireEvent.change(input, { target: { value: 'id > 10' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(props.onWhereChange).toHaveBeenCalledWith('id > 10')
    expect(props.onApplyWhere).toHaveBeenCalledTimes(1)
    expect(props.onClearWhere).toHaveBeenCalledTimes(1)
  })

  // Blueprint §3.1: only four controls stay on the primary surface; everything
  // else has to be reachable through the single `⋯`, not deleted.
  it('keeps the four high-frequency actions on the toolbar', () => {
    const props = createProps({ selectedCount: 2 })

    render(<TableDataToolbar {...props} />)

    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete (2)' }))

    expect(props.onRefresh).toHaveBeenCalledTimes(1)
    expect(props.onInsert).toHaveBeenCalledTimes(1)
    expect(props.onDeleteSelected).toHaveBeenCalledTimes(1)
    expect(screen.getByText('2 selected')).toBeTruthy()
    expect(screen.getByText('1,284 rows')).toBeTruthy()
  })

  it('demotes export, columns, wrapping and selection verbs into the overflow menu', () => {
    const props = createProps({
      selectedCount: 2,
      wrapCells: true,
      columnCounts: { visible: 2, total: 3 }
    })

    const { rerender } = render(<TableDataToolbar {...props} />)

    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export...' }))
    expect(props.onOpenExport).toHaveBeenCalledTimes(1)

    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: '2 / 3 columns' }))
    expect(props.onOpenColumnPanel).toHaveBeenCalledTimes(1)

    openOverflow()
    const wrap = screen.getByRole('menuitemcheckbox', { name: 'Toggle cell wrapping' })
    expect(wrap.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(wrap)
    expect(props.onToggleWrapCells).toHaveBeenCalledTimes(1)

    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy JSON' }))
    expect(props.onCopySelectedRows).toHaveBeenCalledTimes(1)

    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear' }))
    expect(props.onClearSelection).toHaveBeenCalledTimes(1)

    rerender(<TableDataToolbar {...createProps({ ...props, selectedCount: 0 })} />)
    openOverflow()
    expect(screen.getByRole('menuitem', { name: 'Copy JSON' }).getAttribute('aria-disabled')).toBe('true')
  })

  // The page-size `Select` left the pagination bar; it may not disappear.
  it('offers row density and page size as checkable submenus', () => {
    const props = createProps({ columnCounts: { visible: 3, total: 3 } })

    render(<TableDataToolbar {...props} />)

    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Toggle row density' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Comfortable' }))
    expect(props.onSetDensity).toHaveBeenCalledWith('comfortable')

    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rows per page' }))
    expect(screen.getByRole('menuitemcheckbox', { name: '100' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '250' }))
    expect(props.onPageSizeChange).toHaveBeenCalledWith(250)
  })

  it('applies submenu choices after mouse down and retains their checked state', () => {
    function Harness() {
      const [density, setDensity] = useState<'compact' | 'comfortable'>('compact')
      const [pageSize, setPageSize] = useState(100)
      return <TableDataToolbar {...createProps({
        columnCounts: { visible: 3, total: 3 },
        density,
        onSetDensity: setDensity,
        pageSize,
        onPageSizeChange: setPageSize
      })} />
    }

    render(<Harness />)
    const choose = (submenu: string, choice: string) => {
      openOverflow()
      fireEvent.click(screen.getByRole('menuitem', { name: submenu }))
      const item = screen.getByRole('menuitemcheckbox', { name: choice })
      // A real click presses before it activates. A click-only test misses
      // parent menus unmounting their portalled children on mouse down.
      fireEvent.mouseDown(item)
      expect(item.isConnected).toBe(true)
      fireEvent.mouseUp(item)
      fireEvent.click(item)
      expect(screen.queryByRole('menu', { name: 'More actions' })).toBeNull()
      openOverflow()
      fireEvent.click(screen.getByRole('menuitem', { name: submenu }))
      expect(screen.getByRole('menuitemcheckbox', { name: choice }).getAttribute('aria-checked')).toBe('true')
      expect(screen.getAllByRole('menuitemcheckbox').filter((entry) => entry.getAttribute('aria-checked') === 'true')).toHaveLength(1)
      fireEvent.mouseDown(document.body)
    }

    choose('Toggle row density', 'Comfortable')
    choose('Toggle row density', 'Compact')
    choose('Rows per page', '250')
  })

  // Moved here from `TableDataPagination.test.tsx` when the page-size control
  // left the 24px pagination bar: `settings-store.defaultPageSize` seeds the
  // query, and a default this menu cannot offer would be uncheckable.
  it('offers every page size settings-store allows as a default', () => {
    render(<TableDataToolbar {...createProps()} />)

    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rows per page' }))

    const offered = screen
      .getAllByRole('menuitemcheckbox')
      .map((item) => Number(item.textContent))

    for (const size of PAGE_SIZE_OPTIONS) {
      expect(offered).toContain(size)
    }
    expect(offered).toContain(DEFAULT_PAGE_SIZE)
  })

  // −26px of permanent chrome: the amber band became a badge in the subtitle.
  it('shows the missing-primary-key warning as a subtitle badge', () => {
    render(<TableDataToolbar {...createProps({ hasPrimaryKey: false })} />)
    expect(screen.getByText('No primary key')).toBeTruthy()
  })

  it('distinguishes pending filters and lets composition finish before applying', () => {
    const props = createProps({ where: 'name =', hasPendingWhere: true, hasActiveFilter: true })
    const { rerender } = render(<TableDataToolbar {...props} />)
    expect(screen.getByText('Not applied')).toBeTruthy()
    const input = screen.getByRole('searchbox', { name: 'Filter rows with a WHERE condition' })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(props.onApplyWhere).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onApplyWhere).toHaveBeenCalledOnce()
    rerender(<TableDataToolbar {...props} hasPendingWhere={false} />)
    expect(screen.getByText('Filtered')).toBeTruthy()
  })

  it('keeps destructive actions contextual and prevents edits before rows load', () => {
    render(<TableDataToolbar {...createProps({ dataReady: false, loading: true })} />)
    expect(screen.queryByRole('button', { name: 'Delete (0)' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
