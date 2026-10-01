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
  cancelled: boolean
  usesKeyset: boolean
  /** Can coexist with data when a refresh of the same query fails. */
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
  cancel: () => void
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
  const [queryState, setQueryState] = useState<{
    key: string
    data: QueryRowsResult | null
    error: Error | null
    loading: boolean
    cancelled?: boolean
  } | null>(null)
  const [page, setPage] = useState(1)
  const [pageDraft, setPageDraft] = useState('1')
  // Settings supply the *initial* value only — changing the default must not
  // reshuffle a table the user has already tuned.
  const settings = useSettingsStore.getState()
  const [pageSize, setPageSize] = useState(settings.defaultPageSize)
  const [where, setWhere] = useState('')
  const [appliedWhere, setAppliedWhere] = useState('')
  const [orderBy, setOrderBy] = useState<TableDataSortOrder>()
  const [visibleColumns, setVisibleColumnsState] = useState<Set<string>>(new Set())
  const [wrapCells, setWrapCells] = useState(settings.wrapCells)
  const [density, setDensity] = useState<'compact' | 'comfortable'>(settings.density)
  const [reloadToken, setReloadToken] = useState(0)
  const showToastRef = useRef(showToast)
  const endpointKey = JSON.stringify([connectionId, database, table])
  const schemaColumnsRef = useRef<{ endpoint: string; columns: ColumnInfo[] } | null>(null)
  const allColumns = schemaColumnsRef.current?.endpoint === endpointKey ? schemaColumnsRef.current.columns : []
  const projectedColumns = visibleColumns.size > 0 && visibleColumns.size < allColumns.length ? [...visibleColumns].sort() : undefined
  const projectionRequestKey = JSON.stringify(projectedColumns ?? null)
  const cursorScopeKey = JSON.stringify([endpointKey, pageSize, orderBy, appliedWhere, projectionRequestKey, reloadToken, tableReloadToken])
  const cursorCache = useRef<{ scope: string; pages: Map<number, Record<string, unknown>> }>({ scope: cursorScopeKey, pages: new Map() })
  if (cursorCache.current.scope !== cursorScopeKey) cursorCache.current = { scope: cursorScopeKey, pages: new Map() }
  const after = !orderBy && page > 1 ? cursorCache.current.pages.get(page) : undefined
  const request = useMemo(() => ({
    connectionId,
    database,
    table,
    page,
    pageSize,
    orderBy,
    where: appliedWhere || undefined,
    ...(projectedColumns ? { columns: projectedColumns } : {}),
    ...(after ? { after } : {})
  }), [connectionId, database, table, page, pageSize, orderBy, appliedWhere, projectionRequestKey, after])
  const queryKey = JSON.stringify(request)
  // Rows belong to the exact query that loaded them, including its page. A new
  // query must never expose those rows before its effect has started loading.
  const currentQueryState = queryState?.key === queryKey ? queryState : null
  const data = currentQueryState?.data ?? null
  const error = currentQueryState?.error ?? null
  const loading = currentQueryState?.loading ?? true
  const cancelled = currentQueryState?.cancelled ?? false
  const hiddenColumnsStorageKey = getHiddenColumnsStorageKey(connectionId, database, table)

  const operationRef = useRef<{ id: string; cancelled: boolean; cancelling?: boolean } | null>(null)
  const refresh = () => setReloadToken((current) => current + 1)
  const cancel = () => {
    const operation = operationRef.current
    if (!operation || operation.cancelled || operation.cancelling) return
    operation.cancelling = true
    void (async () => {
      try {
        await unwrap(api.operations.cancel(operation.id))
        operation.cancelled = true
        setQueryState((current) => current?.key === queryKey ? { ...current, loading: false, cancelled: true } : current)
      } catch (error) {
        showToastRef.current((error as Error).message, 'error')
      } finally { operation.cancelling = false }
    })()
  }

  useEffect(() => {
    showToastRef.current = showToast
  }, [showToast])

  useEffect(() => {
    setPage(1)
    setPageDraft('1')
    setOrderBy(undefined)
    setWhere('')
    setAppliedWhere('')
    setVisibleColumnsState(new Set())
  }, [connectionId, database, table])

  useEffect(() => {
    let active = true
    const operation = { id: crypto.randomUUID(), cancelled: false }
    operationRef.current = operation
    setQueryState((current) => ({
      key: queryKey,
      data: current?.key === queryKey ? current.data : null,
      error: null,
      loading: true
    }))

    void (async () => {
      try {
        let effectiveRequest = request
        const hidden = readHiddenColumns(hiddenColumnsStorageKey)
        if (!request.columns && hidden.size > 0 && api.schema?.getTable) {
          const schema = await unwrap(api.schema.getTable(connectionId, database, table))
          if (!active || operation.cancelled) return
          const names = schema.columns.map((column) => column.name).filter((name) => !hidden.has(name))
          effectiveRequest = { ...request, columns: names.length > 0 ? names : [schema.columns[0]?.name].filter((name): name is string => Boolean(name)) }
        }
        const result = await unwrap<QueryRowsResult>(api.db.queryRows(effectiveRequest, operation.id))
        if (!active || operation.cancelled) return
        schemaColumnsRef.current = { endpoint: endpointKey, columns: result.columns }
        if (result.nextCursor && !request.orderBy && cursorCache.current.scope === cursorScopeKey) cursorCache.current.pages.set(page + 1, result.nextCursor)
        setQueryState({ key: queryKey, data: result, error: null, loading: false })
      } catch (caught) {
        if (!active || operation.cancelled) return
        const error = caught instanceof Error ? caught : new Error(String(caught))
        setQueryState((current) => ({
          key: queryKey,
          data: current?.key === queryKey ? current.data : null,
          error,
          loading: false
        }))
        showToastRef.current(error.message, 'error')
      } finally {
        if (operationRef.current === operation) operationRef.current = null
      }
    })()
    return () => {
      active = false
      operation.cancelled = true
      if (operationRef.current === operation) operationRef.current = null
      void api.operations?.cancel(operation.id).catch(() => undefined)
    }
  }, [request, queryKey, reloadToken, tableReloadToken])

  const totalPages = useMemo(
    () => (data ? data.totalIsExact === false ? Math.max(page, Math.ceil(data.total / pageSize)) : Math.max(1, Math.ceil(data.total / pageSize)) : page),
    [data, page, pageSize]
  )

  useEffect(() => {
    if (data && data.totalIsExact !== false && page > totalPages) {
      setPage(totalPages)
    }
  }, [data, page, totalPages])

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
    () => (data?.columns ?? allColumns).filter((column) => visibleColumns.has(column.name)),
    [data, allColumns, visibleColumns]
  )
  const hiddenColumnCount = (data?.columns ?? allColumns).length - visibleDataColumns.length
  const hasPendingWhere = where.trim() !== appliedWhere
  const effectiveOrderBy = useMemo<TableDataSortOrder>(() => {
    if (orderBy) return orderBy
    const primaryColumn = data?.primaryKey[0]
    if (!primaryColumn) return undefined
    return { column: primaryColumn, dir: 'ASC' }
  }, [data?.primaryKey, orderBy])

  const applyWhere = () => {
    const normalized = normalizeWhereClauseInput(where)
    setPage(1)
    setPageDraft('1')
    setWhere(normalized)
    setAppliedWhere(normalized)
  }

  const clearWhere = () => {
    setWhere('')
    if (!appliedWhere) return
    setPage(1)
    setPageDraft('1')
    setAppliedWhere('')
  }

  const goToPage = (nextPage: number) => {
    if (!Number.isSafeInteger(nextPage)) {
      setPageDraft(String(page))
      return
    }
    const safePage = Math.max(1, data?.totalIsExact === false ? Math.min(nextPage, 1_000_000) : Math.min(totalPages, nextPage))
    setPage(safePage)
    setPageDraft(String(safePage))
  }

  const submitPageDraft = () => {
    const draft = pageDraft.trim()
    if (/^[+-]?\d+$/.test(draft)) {
      goToPage(Number(draft))
      return
    }
    setPageDraft(String(page))
  }

  const onPageSizeChange = (nextPageSize: number) => {
    setPageSize(nextPageSize)
    setPage(1)
    setPageDraft('1')
  }

  const onSort = (column: string) => {
    setPage(1)
    setPageDraft('1')
    setOrderBy((current) => {
      if (!current || current.column !== column) return { column, dir: 'ASC' }
      if (current.dir === 'ASC') return { column, dir: 'DESC' }
      return undefined
    })
  }

  const setVisibleColumns: Dispatch<SetStateAction<Set<string>>> = (value) => {
    setVisibleColumnsState((current) => {
      const next = typeof value === 'function' ? value(current) : value
      if ([...next].sort().join('\0') !== [...current].sort().join('\0')) { setPage(1); setPageDraft('1') }
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
    cancelled,
    usesKeyset: Boolean(request.after),
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
    cancel,
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
