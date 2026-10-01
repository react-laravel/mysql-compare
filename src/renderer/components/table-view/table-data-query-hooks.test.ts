// @vitest-environment jsdom

import { cleanup, renderHook, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeWhereClauseInput, useTableDataQuery } from './table-data-query-hooks'
import { createQueryRowsResult } from './table-data-test-helpers'

const { queryRowsMock, cancelOperationMock, schemaMock } = vi.hoisted(() => ({
  queryRowsMock: vi.fn(),
  cancelOperationMock: vi.fn(), schemaMock: vi.fn()
}))

vi.mock('@renderer/lib/api', () => ({
  api: {
    operations: { cancel: cancelOperationMock },
    schema: { getTable: schemaMock },
    db: {
      queryRows: queryRowsMock
    }
  },
  unwrap: async <T,>(value: Promise<T> | T): Promise<T> => await value
}))

afterEach(cleanup)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function queryArgs() {
  return {
    connectionId: 'conn-1',
    database: 'db_main',
    table: 'users',
    tableReloadToken: 0,
    showToast: vi.fn()
  }
}

describe('useTableDataQuery', () => {
  beforeEach(() => {
    queryRowsMock.mockReset()
    cancelOperationMock.mockReset().mockResolvedValue({ cancelled: true })
    schemaMock.mockReset().mockResolvedValue({ columns: createQueryRowsResult().columns })
    window.localStorage.clear()
  })

  it('cancels an obsolete query and does not clamp pages to a lower-bound total', async () => {
    const first = deferred<ReturnType<typeof createQueryRowsResult>>()
    queryRowsMock.mockReturnValueOnce(first.promise).mockResolvedValue(createQueryRowsResult({ total: 101, totalIsExact: false, hasMore: true }))
    const { result, unmount } = renderHook(() => useTableDataQuery(queryArgs()))
    const firstId = queryRowsMock.mock.calls[0]![1]
    expect(firstId).toEqual(expect.any(String))
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.data?.totalIsExact).toBe(false))
    expect(cancelOperationMock).toHaveBeenCalledWith(firstId)
    await act(async () => first.resolve(createQueryRowsResult({ total: 9999 })))
    expect(result.current.data?.total).toBe(101)
    act(() => result.current.goToPage(15))
    await waitFor(() => expect(result.current.page).toBe(15))
    expect(queryRowsMock.mock.calls.at(-1)?.[0].page).toBe(15)
    unmount()
  })

  it('uses the cancellation channel and suppresses a cancelled query result', async () => {
    const pending = deferred<ReturnType<typeof createQueryRowsResult>>()
    queryRowsMock.mockReturnValueOnce(pending.promise)
    const args = queryArgs()
    const { result } = renderHook(() => useTableDataQuery(args))
    await act(async () => result.current.cancel())
    expect(cancelOperationMock).toHaveBeenCalledWith(queryRowsMock.mock.calls[0]![1])
    expect(result.current.loading).toBe(false)
    await act(async () => pending.resolve(createQueryRowsResult()))
    expect(result.current.data).toBeNull()
    expect(args.showToast).not.toHaveBeenCalled()
  })

  it('uses remembered primary-key cursors for forward/back paging and resets them after sorting', async () => {
    queryRowsMock.mockImplementation(async (request) => createQueryRowsResult({ total: request.page * 100 + 1, totalIsExact: false, hasMore: true, nextCursor: { id: request.page * 100 } }))
    const { result } = renderHook(() => useTableDataQuery(queryArgs()))
    await waitFor(() => expect(result.current.data?.nextCursor).toEqual({ id: 100 }))
    act(() => result.current.goToPage(2))
    await waitFor(() => expect(queryRowsMock.mock.calls.at(-1)?.[0].after).toEqual({ id: 100 }))
    await waitFor(() => expect(result.current.data?.nextCursor).toEqual({ id: 200 }))
    act(() => result.current.goToPage(3))
    await waitFor(() => expect(queryRowsMock.mock.calls.at(-1)?.[0].after).toEqual({ id: 200 }))
    act(() => result.current.goToPage(2))
    await waitFor(() => expect(queryRowsMock.mock.calls.at(-1)?.[0].after).toEqual({ id: 100 }))
    act(() => result.current.onSort('name'))
    await waitFor(() => expect(queryRowsMock.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ page: 1, orderBy: { column: 'name', dir: 'ASC' } })))
    expect(queryRowsMock.mock.calls.at(-1)?.[0].after).toBeUndefined()
  })

  it('requests a projection before any stored hidden column is downloaded', async () => {
    localStorage.setItem('mysql-compare:table-hidden-columns:v1:conn-1:db_main:users', JSON.stringify(['name']))
    queryRowsMock.mockResolvedValue(createQueryRowsResult())
    const { result } = renderHook(() => useTableDataQuery(queryArgs()))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(schemaMock).toHaveBeenCalledWith('conn-1', 'db_main', 'users')
    expect(queryRowsMock.mock.calls[0]![0].columns).toEqual(['id', 'active'])
    expect(queryRowsMock.mock.calls.every((call) => !call[0].columns.includes('name'))).toBe(true)
    act(() => result.current.setColumnVisibility('active', false))
    await waitFor(() => expect(queryRowsMock.mock.calls.at(-1)?.[0].columns).toEqual(['id']))
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

    expect(queryRowsMock.mock.calls.at(-1)?.[0]).toEqual({
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
      expect(queryRowsMock.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ page: 1, where: 'id > 10' })
      )
    )
    expect(result.current.appliedWhere).toBe('id > 10')

    act(() => {
      result.current.clearWhere()
    })

    await waitFor(() =>
      expect(queryRowsMock.mock.calls.at(-1)?.[0]).toEqual(
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
      expect(queryRowsMock.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ where: "name = '小火球'" })
      )
    )
    expect(result.current.appliedWhere).toBe("name = '小火球'")
    expect(result.current.where).toBe("name = '小火球'")
    expect(result.current.hasPendingWhere).toBe(false)
  })

  it('keeps the last successful rows when refreshing the same query fails and can recover', async () => {
    const rows = createQueryRowsResult()
    const refresh = deferred<typeof rows>()
    queryRowsMock.mockResolvedValueOnce(rows).mockReturnValueOnce(refresh.promise)
    const args = queryArgs()
    const { result } = renderHook(() => useTableDataQuery(args))
    await waitFor(() => expect(result.current.data).toBe(rows))

    act(() => result.current.refresh())
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBe(rows)
    await act(async () => refresh.reject('refresh unavailable'))

    expect(result.current.data).toBe(rows)
    expect(result.current.error?.message).toBe('refresh unavailable')
    expect(result.current.loading).toBe(false)
    expect(args.showToast).toHaveBeenCalledWith('refresh unavailable', 'error')

    const recovered = createQueryRowsResult({ rows: [{ id: 4, name: 'Dora', active: 1 }] })
    queryRowsMock.mockResolvedValueOnce(recovered)
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.data).toBe(recovered))
    expect(result.current.error).toBeNull()
  })

  it.each(['page', 'filter', 'sort', 'pageSize', 'table', 'database', 'connection'] as const)(
    'does not present old rows as a new %s query while loading or after failure',
    async (change) => {
      const rows = createQueryRowsResult({ total: 600 })
      const nextQuery = deferred<typeof rows>()
      queryRowsMock.mockResolvedValueOnce(rows).mockReturnValueOnce(nextQuery.promise)
      const args = queryArgs()
      const { result, rerender } = renderHook((props) => useTableDataQuery(props), { initialProps: args })
      await waitFor(() => expect(result.current.data).toBe(rows))

      if (change === 'filter') act(() => result.current.setWhere('id > 10'))
      act(() => {
        if (change === 'page') result.current.goToPage(2)
        if (change === 'filter') result.current.applyWhere()
        if (change === 'sort') result.current.onSort('name')
        if (change === 'pageSize') result.current.onPageSizeChange(50)
        if (change === 'table') rerender({ ...args, table: 'sessions' })
        if (change === 'database') rerender({ ...args, database: 'db_other' })
        if (change === 'connection') rerender({ ...args, connectionId: 'conn-2' })
      })
      expect(result.current.data).toBeNull()
      expect(result.current.loading).toBe(true)
      await act(async () => nextQuery.reject(new Error('new query failed')))

      expect(result.current.data).toBeNull()
      expect(result.current.error?.message).toBe('new query failed')
      expect(result.current.loading).toBe(false)
      if (change === 'page') expect(result.current.page).toBe(2)
      expect(queryRowsMock).toHaveBeenCalledTimes(2)
    }
  )

  it.each(['success', 'failure'] as const)('ignores a stale %s after a newer request finishes', async (outcome) => {
    const stale = deferred<ReturnType<typeof createQueryRowsResult>>()
    const latest = deferred<ReturnType<typeof createQueryRowsResult>>()
    queryRowsMock.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise)
    const args = queryArgs()
    const { result } = renderHook(() => useTableDataQuery(args))
    act(() => result.current.refresh())

    const rows = createQueryRowsResult({ rows: [{ id: 4, name: 'Dora', active: 1 }] })
    await act(async () => latest.resolve(rows))
    await act(async () => {
      if (outcome === 'success') stale.resolve(createQueryRowsResult())
      else stale.reject(new Error('stale failure'))
    })

    expect(result.current.data).toBe(rows)
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(args.showToast).not.toHaveBeenCalled()
  })

  it('does not report an in-flight query failure after unmount', async () => {
    const pending = deferred<ReturnType<typeof createQueryRowsResult>>()
    queryRowsMock.mockReturnValueOnce(pending.promise)
    const args = queryArgs()
    const { unmount } = renderHook(() => useTableDataQuery(args))

    unmount()
    await act(async () => pending.reject(new Error('closed table request failed')))
    expect(args.showToast).not.toHaveBeenCalled()
  })

  it('clamps integer page drafts and restores invalid drafts even when the page does not change', async () => {
    queryRowsMock.mockResolvedValue(createQueryRowsResult({ total: 200 }))
    const args = queryArgs()
    const { result } = renderHook(() => useTableDataQuery(args))
    await waitFor(() => expect(result.current.data).not.toBeNull())

    for (const [draft, expected] of [['0', 1], ['-3', 1], ['999', 2], ['999', 2], [' 01 ', 1]] as const) {
      act(() => result.current.setPageDraft(draft))
      act(() => result.current.submitPageDraft())
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.page).toBe(expected)
      expect(result.current.pageDraft).toBe(String(expected))
    }

    const calls = queryRowsMock.mock.calls.length
    for (const draft of ['', '2junk', '1.5', '1e2', 'Infinity', '9007199254740992']) {
      act(() => result.current.setPageDraft(draft))
      act(() => result.current.submitPageDraft())
      expect(result.current.page).toBe(1)
      expect(result.current.pageDraft).toBe('1')
    }
    expect(queryRowsMock).toHaveBeenCalledTimes(calls)
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
      expect(queryRowsMock.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ page: 1, orderBy: { column: 'name', dir: 'ASC' } })
      )
    )

    act(() => {
      result.current.onSort('name')
    })
    await waitFor(() =>
      expect(queryRowsMock.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ orderBy: { column: 'name', dir: 'DESC' } })
      )
    )

    act(() => {
      result.current.onSort('name')
    })
    await waitFor(() =>
      expect(queryRowsMock.mock.calls.at(-1)?.[0]).toEqual(
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
      expect(queryRowsMock.mock.calls.at(-1)?.[0]).toEqual(
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
