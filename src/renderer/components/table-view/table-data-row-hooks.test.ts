// @vitest-environment jsdom

import { cleanup, renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Translator } from '../../i18n'
import { useTableDataRowActions } from './table-data-row-hooks'
import {
  createNoPrimaryKeyQueryRowsResult,
  createQueryRowsResult,
  testRows
} from './table-data-test-helpers'

const { deleteRowsMock, insertRowMock, updateRowMock } = vi.hoisted(() => ({
  deleteRowsMock: vi.fn(),
  insertRowMock: vi.fn(),
  updateRowMock: vi.fn()
}))

vi.mock('@renderer/lib/api', () => ({
  api: {
    db: {
      deleteRows: deleteRowsMock,
      insertRow: insertRowMock,
      updateRow: updateRowMock
    }
  },
  unwrap: async <T,>(value: Promise<T> | T): Promise<T> => await value
}))

afterEach(cleanup)

type ClipboardStub = Pick<Clipboard, 'writeText'>
type NavigatorWithOptionalClipboard = {
  clipboard?: ClipboardStub
}

function getNavigatorWithClipboard(): NavigatorWithOptionalClipboard {
  return navigator as unknown as NavigatorWithOptionalClipboard
}

const t: Translator = (key, vars) => {
  if (vars?.count !== undefined) return `${key}:${vars.count}`
  return key
}

describe('useTableDataRowActions', () => {
  let originalClipboard: ClipboardStub | undefined

  beforeEach(() => {
    deleteRowsMock.mockReset()
    insertRowMock.mockReset()
    updateRowMock.mockReset()
    originalClipboard = getNavigatorWithClipboard().clipboard
  })

  afterEach(() => {
    if (originalClipboard === undefined) {
      delete getNavigatorWithClipboard().clipboard
    } else {
      getNavigatorWithClipboard().clipboard = originalClipboard
    }
  })

  it('supports range selection and clearing the selection', () => {
    const data = createQueryRowsResult()

    const { result } = renderHook(() =>
      useTableDataRowActions({
        connectionId: 'conn-1',
        database: 'db_main',
        table: 'users',
        data,
        showToast: vi.fn(),
        t,
        refresh: vi.fn()
      })
    )

    act(() => {
      result.current.onToggleSelect(1, false)
      result.current.onToggleSelect(2, true)
    })

    expect(Array.from(result.current.selected)).toEqual([1, 2])
    expect(result.current.selectedRows).toEqual([testRows[1], testRows[2]])
    expect(result.current.exportScopes).toEqual(['all', 'filtered', 'page', 'selected'])

    act(() => {
      result.current.onClearSelection()
    })

    expect(result.current.selected.size).toBe(0)
  })

  it('toggles all rows on the current page', () => {
    const data = createQueryRowsResult()

    const { result } = renderHook(() =>
      useTableDataRowActions({
        connectionId: 'conn-1',
        database: 'db_main',
        table: 'users',
        data,
        showToast: vi.fn(),
        t,
        refresh: vi.fn()
      })
    )

    act(() => {
      result.current.onToggleSelectPage()
    })
    expect(result.current.selected.size).toBe(data.rows.length)

    act(() => {
      result.current.onToggleSelectPage()
    })
    expect(result.current.selected.size).toBe(0)
  })

  it('copies selected rows to the clipboard', async () => {
    const data = createQueryRowsResult()
    const showToast = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    getNavigatorWithClipboard().clipboard = { writeText }

    const { result } = renderHook(() =>
      useTableDataRowActions({
        connectionId: 'conn-1',
        database: 'db_main',
        table: 'users',
        data,
        showToast,
        t,
        refresh: vi.fn()
      })
    )

    act(() => {
      result.current.onToggleSelect(0, false)
      result.current.onToggleSelect(1, false)
    })

    await act(async () => {
      await result.current.onCopySelectedRows()
    })

    expect(writeText).toHaveBeenCalledWith(JSON.stringify([testRows[0], testRows[1]], null, 2))
    expect(showToast).toHaveBeenCalledWith('tableData.copiedRows:2', 'success')
  })

  it('refuses deletes when the table has no primary key', async () => {
    const data = createNoPrimaryKeyQueryRowsResult()
    const showToast = vi.fn()

    const { result } = renderHook(() =>
      useTableDataRowActions({
        connectionId: 'conn-1',
        database: 'db_main',
        table: 'users',
        data,
        showToast,
        t,
        refresh: vi.fn()
      })
    )

    act(() => {
      result.current.onToggleSelect(0, false)
    })

    act(() => {
      result.current.onDeleteSelected()
    })

    expect(result.current.pendingDelete).toBeNull()
    expect(showToast).toHaveBeenCalledWith('tableData.refuseNoPrimaryKey', 'error')
    expect(deleteRowsMock).not.toHaveBeenCalled()
  })

  it('deletes selected rows by primary key and refreshes the table', async () => {
    const data = createQueryRowsResult()
    const showToast = vi.fn()
    const refresh = vi.fn()
    deleteRowsMock.mockResolvedValue({ affectedRows: 2 })

    const { result } = renderHook(() =>
      useTableDataRowActions({
        connectionId: 'conn-1',
        database: 'db_main',
        table: 'users',
        data,
        showToast,
        t,
        refresh
      })
    )

    act(() => {
      result.current.onToggleSelect(0, false)
      result.current.onToggleSelect(1, false)
    })

    // Deleting is now a two-step: the hook parks the request and
    // `TableDataView`'s `ConfirmDialog` runs it (no native `confirm()`).
    act(() => {
      result.current.onDeleteSelected()
    })
    expect(result.current.pendingDelete).toEqual([0, 1])
    expect(deleteRowsMock).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.confirmDeleteRows()
    })

    expect(deleteRowsMock).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      database: 'db_main',
      table: 'users',
      pkRows: [{ id: 1 }, { id: 2 }]
    })
    expect(showToast).toHaveBeenCalledWith('tableData.rowsDeleted:2', 'success')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('submits inserted rows and clears editing state', async () => {
    const data = createQueryRowsResult()
    const showToast = vi.fn()
    const refresh = vi.fn()
    insertRowMock.mockResolvedValue({})

    const { result } = renderHook(() =>
      useTableDataRowActions({
        connectionId: 'conn-1',
        database: 'db_main',
        table: 'users',
        data,
        showToast,
        t,
        refresh
      })
    )

    act(() => {
      result.current.setEditing({ mode: 'insert' })
    })

    await act(async () => {
      await result.current.submitEditing({ name: 'Dora' })
    })

    expect(insertRowMock).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      database: 'db_main',
      table: 'users',
      values: { name: 'Dora' }
    })
    expect(showToast).toHaveBeenCalledWith('tableData.rowInserted', 'success')
    expect(result.current.editing).toBeNull()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('submits updated rows using the original primary key values', async () => {
    const data = createQueryRowsResult()
    const showToast = vi.fn()
    const refresh = vi.fn()
    updateRowMock.mockResolvedValue({})

    const { result } = renderHook(() =>
      useTableDataRowActions({
        connectionId: 'conn-1',
        database: 'db_main',
        table: 'users',
        data,
        showToast,
        t,
        refresh
      })
    )

    act(() => {
      result.current.setEditing({ mode: 'edit', row: testRows[0] })
    })

    await act(async () => {
      await result.current.submitEditing({ name: 'Alice 2' }, { id: 1 })
    })

    expect(updateRowMock).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      database: 'db_main',
      table: 'users',
      pkValues: { id: 1 },
      changes: { name: 'Alice 2' }
    })
    expect(showToast).toHaveBeenCalledWith('tableData.rowUpdated', 'success')
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})