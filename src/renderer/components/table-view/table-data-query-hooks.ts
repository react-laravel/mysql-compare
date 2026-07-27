import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { api, unwrap } from '@renderer/lib/api'
import { useSettingsStore } from '@renderer/store/settings-store'
import type { ColumnInfo, QueryRowsResult } from '../../../shared/types'

type ToastLevel = 'info' | 'error' | 'success'
type ShowToast = (message: string, level?: ToastLevel) => void

export type TableDataSortOrder = { column: string; dir: 'ASC' | 'DESC' } | undefined

const DOUBLE_QUOTED_COMPARISON_VALUE =
  /((?:^|[\s(])(?:[A-Za-z_][\w.]*|"[^"]+"|`[^`]+`|\[[^\]]+\])\s*(?:=|<>|!=|<=|>=|<|>|\bLIKE\b|\bILIKE\b)\s*)"((?:[^"\\]|\\.)*)"/gi
const HIDDEN_COLUMNS_STORAGE_PREFIX = 'mysql-compare:table-hidden-columns:v1'

interface UseTableDataQueryArgs {
  connectionId: string
  database: string
  table: string
  tableReloadToken: number
  showToast: ShowToast
}

interface UseTableDataQueryResult {
  data: QueryRowsResult | null
  loading: boolean
  /** drives `EmptyState variant="error"` with a Retry action (DS §7.5) */
  error: Error | null
  page: number
  pageDraft: string
  pageSize: number
  where: string
  appliedWhere: string
  orderBy: TableDataSortOrder
  effectiveOrderBy: TableDataSortOrder
  visibleColumns: Set<string>
  wrapCells: boolean
  density: 'compact' | 'comfortable'
  totalPages: number
  visibleDataColumns: ColumnInfo[]
  hiddenColumnCount: number
  hasPendingWhere: boolean
  setWhere: Dispatch<SetStateAction<string>>
  setPageDraft: Dispatch<SetStateAction<string>>
  setWrapCells: Dispatch<SetStateAction<boolean>>
  setDensity: Dispatch<SetStateAction<'compact' | 'comfortable'>>
  setVisibleColumns: Dispatch<SetStateAction<Set<string>>>
  refresh: () => void
  applyWhere: () => void
  clearWhere: () => void
  goToPage: (nextPage: number) => void
  submitPageDraft: () => void
  onPageSizeChange: (pageSize: number) => void
  onSort: (column: string) => void
  setColumnVisibility: (columnName: string, visible: boolean) => void
}

export function useTableDataQuery({
  connectionId,
  database,
  table,
  tableReloadToken,
  showToast
}: UseTableDataQueryArgs): UseTableDataQueryResult {
  const [data, setData] = useState<QueryRowsResult | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [page, setPage] = useState(1)
  const [pageDraft, setPageDraft] = useState('1')
  // Settings supply the *initial* value only — changing the default must not
  // reshuffle a table the user has already tuned.
  const settings = useSettingsStore.getState()
  const [pageSize, setPageSize] = useState(settings.defaultPageSize)
  const [where, setWhere] = useState('')
  const [appliedWhere, setAppliedWhere] = useState('')
  const [orderBy, setOrderBy] = useState<TableDataSortOrder>()
  const [loading, setLoading] = useState(false)
  const [visibleColumns, setVisibleColumnsState] = useState<Set<string>>(new Set())
  const [wrapCells, setWrapCells] = useState(settings.wrapCells)
  const [density, setDensity] = useState<'compact' | 'comfortable'>(settings.density)
  const [reloadToken, setReloadToken] = useState(0)
  const requestIdRef = useRef(0)
  const orderByKey = orderBy ? `${orderBy.column}:${orderBy.dir}` : ''
  const hiddenColumnsStorageKey = getHiddenColumnsStorageKey(connectionId, database, table)

  const refresh = () => setReloadToken((current) => current + 1)

  useEffect(() => {
    setPage(1)
    setPageDraft('1')
    setOrderBy(undefined)
    setWhere('')
    setAppliedWhere('')
    setVisibleColumnsState(new Set())
    setData(null)
    setError(null)
  }, [connectionId, database, table])

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)

    void (async () => {
      try {
        const result = await unwrap<QueryRowsResult>(
          api.db.queryRows({
            connectionId,
            database,
            table,
            page,
            pageSize,
            orderBy,
            where: appliedWhere || undefined
          })
        )
        if (requestId !== requestIdRef.current) return
        setData(result)
        setError(null)
      } catch (caught) {
        if (requestId !== requestIdRef.current) return
        setData(null)
        // The view renders the failure itself; the toast is the "you navigated
        // away" channel, so both stay.
        setError(caught instanceof Error ? caught : new Error(String(caught)))
        showToast((caught as Error).message, 'error')
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false)
        }
      }
    })()
  }, [
    appliedWhere,
    connectionId,
    database,
    orderByKey,
    page,
    pageSize,
    reloadToken,
    showToast,
    table,
    tableReloadToken
  ])

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1),
    [data, pageSize]
  )

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  useEffect(() => {
    setPageDraft(String(page))
  }, [page])

  useEffect(() => {
    if (!data) return
    const allColumns = data.columns.map((column) => column.name)
    const hiddenColumns = readHiddenColumns(hiddenColumnsStorageKey)
    const activeHiddenColumns = allColumns.filter((column) => hiddenColumns.has(column))
    const next = new Set(allColumns.filter((column) => !hiddenColumns.has(column)))
    setVisibleColumnsState(next.size > 0 ? next : new Set(allColumns))
    writeHiddenColumns(hiddenColumnsStorageKey, activeHiddenColumns)
  }, [data, hiddenColumnsStorageKey])

  const visibleDataColumns = useMemo(
    () => (data ? data.columns.filter((column) => visibleColumns.has(column.name)) : []),
    [data, visibleColumns]
  )
  const hiddenColumnCount = data ? data.columns.length - visibleDataColumns.length : 0
  const hasPendingWhere = where.trim() !== appliedWhere
  const effectiveOrderBy = useMemo<TableDataSortOrder>(() => {
    if (orderBy) return orderBy
    const primaryColumn = data?.primaryKey[0]
    if (!primaryColumn) return undefined
    return { column: primaryColumn, dir: 'ASC' }
  }, [data?.primaryKey, orderBy])

  const applyWhere = () => {
    setPage(1)
    setAppliedWhere(normalizeWhereClauseInput(where))
  }

  const clearWhere = () => {
    setWhere('')
    if (!appliedWhere) return
    setPage(1)
    setAppliedWhere('')
  }

  const goToPage = (nextPage: number) => {
    const safePage = Math.max(1, Math.min(totalPages, nextPage))
    setPage(safePage)
  }

  const submitPageDraft = () => {
    const parsed = Number.parseInt(pageDraft, 10)
    if (Number.isFinite(parsed)) {
      goToPage(parsed)
      return
    }
    setPageDraft(String(page))
  }

  const onPageSizeChange = (nextPageSize: number) => {
    setPageSize(nextPageSize)
    setPage(1)
  }

  const onSort = (column: string) => {
    setPage(1)
    setOrderBy((current) => {
      if (!current || current.column !== column) return { column, dir: 'ASC' }
      if (current.dir === 'ASC') return { column, dir: 'DESC' }
      return undefined
    })
  }

  const setVisibleColumns: Dispatch<SetStateAction<Set<string>>> = (value) => {
    setVisibleColumnsState((current) => {
      const next = typeof value === 'function' ? value(current) : value
      if (data) {
        const hiddenColumns = data.columns
          .map((column) => column.name)
          .filter((column) => !next.has(column))
        writeHiddenColumns(hiddenColumnsStorageKey, hiddenColumns)
      }
      return next
    })
  }

  const setColumnVisibility = (columnName: string, visible: boolean) => {
    setVisibleColumns((current) => {
      const next = new Set(current)
      if (visible) {
        next.add(columnName)
        return next
      }
      if (next.size <= 1) return current
      next.delete(columnName)
      return next
    })
  }

  return {
    data,
    loading,
    error,
    page,
    pageDraft,
    pageSize,
    where,
    appliedWhere,
    orderBy,
    effectiveOrderBy,
    visibleColumns,
    wrapCells,
    density,
    totalPages,
    visibleDataColumns,
    hiddenColumnCount,
    hasPendingWhere,
    setWhere,
    setPageDraft,
    setWrapCells,
    setDensity,
    setVisibleColumns,
    refresh,
    applyWhere,
    clearWhere,
    goToPage,
    submitPageDraft,
    onPageSizeChange,
    onSort,
    setColumnVisibility
  }
}

export function normalizeWhereClauseInput(where: string): string {
  return where.trim().replace(DOUBLE_QUOTED_COMPARISON_VALUE, (_match, prefix: string, value: string) => {
    const normalizedValue = value.replace(/\\"/g, '"').replace(/'/g, "''")
    return `${prefix}'${normalizedValue}'`
  })
}

function getHiddenColumnsStorageKey(connectionId: string, database: string, table: string): string {
  return [
    HIDDEN_COLUMNS_STORAGE_PREFIX,
    encodeURIComponent(connectionId),
    encodeURIComponent(database),
    encodeURIComponent(table)
  ].join(':')
}

function readHiddenColumns(storageKey: string): Set<string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((column): column is string => typeof column === 'string'))
  } catch {
    return new Set()
  }
}

function writeHiddenColumns(storageKey: string, columns: string[]): void {
  try {
    if (columns.length === 0) {
      window.localStorage.removeItem(storageKey)
      return
    }
    window.localStorage.setItem(storageKey, JSON.stringify(columns))
  } catch {
    // Column visibility still works for this session when storage is unavailable.
  }
}
