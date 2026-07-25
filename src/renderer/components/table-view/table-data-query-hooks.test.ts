// @vitest-environment jsdom

import { cleanup, renderHook, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeWhereClauseInput, useTableDataQuery } from './table-data-query-hooks'
import { createQueryRowsResult } from './table-data-test-helpers'

const { queryRowsMock } = vi.hoisted(() => ({
  queryRowsMock: vi.fn()
}))

vi.mock('@renderer/lib/api', () => ({
  api: {
    db: {
      queryRows: queryRowsMock
    }
  },
  unwrap: async <T,>(value: Promise<T> | T): Promise<T> => await value
}))

afterEach(cleanup)

describe('useTableDataQuery', () => {
  beforeEach(() => {
    queryRowsMock.mockReset()
    window.localStorage.clear()
  })

  it('loads rows and initializes all columns as visible', async () => {
    queryRowsMock.mockResolvedValue(createQueryRowsResult())
    const showToast = vi.fn()

    const { result } = renderHook(() =>
      useTableDataQuery({
        connectionId: 'conn-1',
        database: 'db_main',
        table: 'users',
        tableReloadToken: 0,
        showToast
      })
    )

    await waitFor(() => expect(result.current.data?.rows).toHaveLength(3))

    expect(queryRowsMock).toHaveBeenLastCalledWith({
      connectionId: 'conn-1',
      database: 'db_main',
      table: 'users',
      page: 1,
      pageSize: 100,
      orderBy: undefined,
      where: undefined
    })
    expect(Array.from(result.current.visibleColumns)).toEqual(['id', 'name', 'active'])
    expect(result.current.effectiveOrderBy).toEqual({ column: 'id', dir: 'ASC' })
    expect(result.current.visibleDataColumns.map((column) => column.name)).toEqual([
      'id',
      'name',
      'active'
    ])
    expect(result.current.hiddenColumnCount).toBe(0)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('applies and clears WHERE clauses while resetting pagination', async () => {
    queryRowsMock.mockResolvedValue(createQueryRowsResult({ total: 180 }))

    const { result } = renderHook(() =>
      useTableDataQuery({
        connectionId: 'conn-1',
        database: 'db_main',
        table: 'users',
        tableReloadToken: 0,
        showToast: vi.fn()
      })
    )

    await waitFor(() => expect(result.current.data).not.toBeNull())

    act(() => {
      result.current.goToPage(2)
    })
    await waitFor(() => expect(result.current.page).toBe(2))

    act(() => {
      result.current.setWhere(' id > 10 ')
    })
    act(() => {
      result.current.applyWhere()
    })

    await waitFor(() =>
      expect(queryRowsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, where: 'id > 10' })
      )
    )
    expect(result.current.appliedWhere).toBe('id > 10')

    act(() => {
      result.current.clearWhere()
    })

    await waitFor(() =>
      expect(queryRowsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, where: undefined })
      )
    )
    expect(result.current.where).toBe('')
    expect(result.current.appliedWhere).toBe('')
  })

  it('normalizes double-quoted comparison values before applying WHERE clauses', async () => {
    queryRowsMock.mockResolvedValue(createQueryRowsResult())

    const { result } = renderHook(() =>
      useTableDataQuery({
        connectionId: 'conn-1',
        database: 'db_main',
        table: 'users',
        tableReloadToken: 0,
        showToast: vi.fn()
      })
    )

    await waitFor(() => expect(result.current.data).not.toBeNull())

    act(() => {
      result.current.setWhere('name = "小火球"')
    })
    act(() => {
      result.current.applyWhere()
    })

    await waitFor(() =>
      expect(queryRowsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: "name = '小火球'" })
      )
    )
    expect(result.current.appliedWhere).toBe("name = '小火球'")
  })

  it('cycles sort order and updates the page size', async () => {
    queryRowsMock.mockResolvedValue(createQueryRowsResult({ total: 600 }))

    const { result } = renderHook(() =>
      useTableDataQuery({
        connectionId: 'conn-1',
        database: 'db_main',
        table: 'users',
        tableReloadToken: 0,
        showToast: vi.fn()
      })
    )

    await waitFor(() => expect(result.current.data).not.toBeNull())

    act(() => {
      result.current.onSort('name')
    })
    await waitFor(() =>
      expect(queryRowsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, orderBy: { column: 'name', dir: 'ASC' } })
      )
    )

    act(() => {
      result.current.onSort('name')
    })
    await waitFor(() =>
      expect(queryRowsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ orderBy: { column: 'name', dir: 'DESC' } })
      )
    )

    act(() => {
      result.current.onSort('name')
    })
    await waitFor(() =>
      expect(queryRowsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ orderBy: undefined })
      )
    )

    act(() => {
      result.current.setPageDraft('6')
    })
    act(() => {
      result.current.submitPageDraft()
    })
    await waitFor(() => expect(result.current.page).toBe(6))

    act(() => {
      result.current.onPageSizeChange(50)
    })
    await waitFor(() =>
      expect(queryRowsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, pageSize: 50 })
      )
    )
  })

  it('tracks column visibility and supports manual refreshes', async () => {
    queryRowsMock.mockResolvedValue(createQueryRowsResult())

    const { result } = renderHook(() =>
      useTableDataQuery({
        connectionId: 'conn-1',
        database: 'db_main',
        table: 'users',
        tableReloadToken: 0,
        showToast: vi.fn()
      })
    )

    await waitFor(() => expect(result.current.data).not.toBeNull())

    act(() => {
      result.current.setColumnVisibility('active', false)
      result.current.setColumnVisibility('name', false)
      result.current.setColumnVisibility('id', false)
    })

    expect(Array.from(result.current.visibleColumns)).toEqual(['id'])
    expect(result.current.hiddenColumnCount).toBe(2)

    const beforeRefreshCalls = queryRowsMock.mock.calls.length
    act(() => {
      result.current.refresh()
    })

    await waitFor(() => expect(queryRowsMock.mock.calls.length).toBeGreaterThan(beforeRefreshCalls))
  })

  it('restores hidden columns for the same connection, database, and table', async () => {
    queryRowsMock.mockResolvedValue(createQueryRowsResult())

    const firstView = renderHook(() =>
      useTableDataQuery({
        connectionId: 'conn-1',
        database: 'db_main',
        table: 'users',
        tableReloadToken: 0,
        showToast: vi.fn()
      })
    )

    await waitFor(() => expect(firstView.result.current.data).not.toBeNull())
    act(() => {
      firstView.result.current.setColumnVisibility('name', false)
    })
    expect(Array.from(firstView.result.current.visibleColumns)).toEqual(['id', 'active'])
    firstView.unmount()

    const schemaWithNewColumn = createQueryRowsResult()
    schemaWithNewColumn.columns = [
      ...schemaWithNewColumn.columns,
      {
        name: 'created_at',
        type: 'timestamp',
        nullable: true,
        defaultValue: null,
        isPrimaryKey: false,
        isAutoIncrement: false,
        comment: '',
        columnKey: ''
      }
    ]
    queryRowsMock.mockResolvedValue(schemaWithNewColumn)

    const reopenedView = renderHook(() =>
      useTableDataQuery({
        connectionId: 'conn-1',
        database: 'db_main',
        table: 'users',
        tableReloadToken: 0,
        showToast: vi.fn()
      })
    )

    await waitFor(() =>
      expect(Array.from(reopenedView.result.current.visibleColumns)).toEqual([
        'id',
        'active',
        'created_at'
      ])
    )
    reopenedView.unmount()

    const otherServerView = renderHook(() =>
      useTableDataQuery({
        connectionId: 'conn-2',
        database: 'db_main',
        table: 'users',
        tableReloadToken: 0,
        showToast: vi.fn()
      })
    )

    await waitFor(() =>
      expect(Array.from(otherServerView.result.current.visibleColumns)).toEqual([
        'id',
        'name',
        'active',
        'created_at'
      ])
    )
  })
})

describe('normalizeWhereClauseInput', () => {
  it('keeps single quoted values and identifier expressions intact', () => {
    expect(normalizeWhereClauseInput("name = '小火球'")).toBe("name = '小火球'")
    expect(normalizeWhereClauseInput('payload->>"name" = \'小火球\'')).toBe(
      'payload->>"name" = \'小火球\''
    )
  })

  it('escapes single quotes inside normalized double-quoted values', () => {
    expect(normalizeWhereClauseInput("name = \"Sam's skill\"")).toBe("name = 'Sam''s skill'")
  })
})
