import { useMemo, useRef, useState, type MouseEvent } from 'react'
import type { QueryRowsResult } from '../../../shared/types'
import { buildRowKey } from './table-compare-utils'

export function useComparePaneSelection(data: QueryRowsResult | null, keyColumns: string[]) {
  const selectionEnabled = data?.hasPrimaryKey ?? false
  const [selectedRows, setSelectedRows] = useState<Record<string, Record<string, unknown>>>({})
  const selectionAnchorKeyRef = useRef<string | null>(null)

  const selectedCount = Object.keys(selectedRows).length
  const selectedKeySet = useMemo(() => new Set(Object.keys(selectedRows)), [selectedRows])
  const visibleKeys = useMemo(() => {
    if (!data || !selectionEnabled) return []

    return data.rows
      .map((row) => buildRowKey(row, keyColumns))
      .filter((key): key is string => key !== null)
  }, [data, keyColumns, selectionEnabled])
  const visibleRowsWithKeys = useMemo(() => {
    if (!data || !selectionEnabled) return []

    return data.rows.flatMap((row) => {
      const key = buildRowKey(row, keyColumns)
      return key ? [{ key, row }] : []
    })
  }, [data, keyColumns, selectionEnabled])
  const visibleKeySet = useMemo(() => new Set(visibleKeys), [visibleKeys])
  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeySet.has(key))

  const clearSelection = () => {
    setSelectedRows({})
    selectionAnchorKeyRef.current = null
  }

  const toggleRow = (row: Record<string, unknown>, event: MouseEvent<HTMLInputElement>) => {
    const rowKey = buildRowKey(row, keyColumns)
    if (!rowKey) return

    const anchorKey = selectionAnchorKeyRef.current
    const shouldSelect = event.currentTarget.checked

    setSelectedRows((current) => {
      if (event.shiftKey && anchorKey) {
        const anchorIndex = visibleRowsWithKeys.findIndex((item) => item.key === anchorKey)
        const rowIndex = visibleRowsWithKeys.findIndex((item) => item.key === rowKey)

        if (anchorIndex !== -1 && rowIndex !== -1) {
          const [start, end] =
            anchorIndex < rowIndex ? [anchorIndex, rowIndex] : [rowIndex, anchorIndex]
          const next = { ...current }

          for (const item of visibleRowsWithKeys.slice(start, end + 1)) {
            if (shouldSelect) {
              next[item.key] = item.row
            } else {
              delete next[item.key]
            }
          }

          return next
        }
      }

      if (current[rowKey]) {
        const { [rowKey]: _removed, ...rest } = current
        return rest
      }

      return {
        ...current,
        [rowKey]: row
      }
    })

    selectionAnchorKeyRef.current = rowKey
  }

  const toggleAllVisible = () => {
    if (!data || !selectionEnabled) return

    setSelectedRows((current) => {
      if (allVisibleSelected) {
        return Object.fromEntries(
          Object.entries(current).filter(([rowKey]) => !visibleKeySet.has(rowKey))
        )
      }

      const next = { ...current }
      for (const row of data.rows) {
        const rowKey = buildRowKey(row, keyColumns)
        if (rowKey) next[rowKey] = row
      }
      return next
    })
  }

  const removeSelectedKeys = (rowKeys: Set<string>) => {
    setSelectedRows((current) =>
      Object.fromEntries(Object.entries(current).filter(([rowKey]) => !rowKeys.has(rowKey)))
    )
  }

  return {
    selectionEnabled,
    selectedRows,
    selectedCount,
    selectedKeySet,
    allVisibleSelected,
    toggleRow,
    toggleAllVisible,
    clearSelection,
    removeSelectedKeys
  }
}
