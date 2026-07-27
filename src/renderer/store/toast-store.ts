import type { ReactNode } from 'react'
import { create } from 'zustand'

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger'

export interface ToastOptions {
  id?: string
  tone?: ToastTone
  title: ReactNode
  description?: ReactNode
  /** collapsed <details> — stack traces, SQL errors */
  details?: string
  action?: { label: string; onClick: () => void }
  /** 4000 by default; `null` is sticky. `danger` defaults to sticky. */
  durationMs?: number | null
}

export interface ToastRecord extends ToastOptions {
  id: string
  tone: ToastTone
  createdAt: number
}

interface ToastState {
  toasts: ToastRecord[]
  show: (options: ToastOptions) => string
  update: (id: string, patch: Partial<ToastOptions>) => void
  dismiss: (id: string) => void
  clear: () => void
}

const DEFAULT_DURATION = 4000
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function clearTimer(id: string): void {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
}

let sequence = 0

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  show: (options) => {
    const id = options.id ?? `toast-${++sequence}`
    const tone = options.tone ?? 'neutral'
    const record: ToastRecord = { ...options, id, tone, createdAt: Date.now() }

    set((state) => {
      const existing = state.toasts.findIndex((toast) => toast.id === id)
      if (existing >= 0) {
        const next = state.toasts.slice()
        next[existing] = record
        return { toasts: next }
      }
      return { toasts: [...state.toasts, record] }
    })

    scheduleDismiss(id, record, get)
    return id
  },

  update: (id, patch) => {
    set((state) => ({
      toasts: state.toasts.map((toast) => (toast.id === id ? { ...toast, ...patch } : toast))
    }))
    const next = get().toasts.find((toast) => toast.id === id)
    if (next) scheduleDismiss(id, next, get)
  },

  dismiss: (id) => {
    clearTimer(id)
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  },

  clear: () => {
    for (const id of timers.keys()) clearTimer(id)
    set({ toasts: [] })
  }
}))

function scheduleDismiss(
  id: string,
  record: ToastRecord,
  get: () => ToastState
): void {
  clearTimer(id)
  // A failure the user was not looking at must not disappear on its own.
  const duration =
    record.durationMs === undefined
      ? record.tone === 'danger'
        ? null
        : DEFAULT_DURATION
      : record.durationMs
  if (duration == null) return
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id)
      get().dismiss(id)
    }, duration)
  )
}

/**
 * Imperative API — usable outside React, which is what a background job needs.
 * `update` is what lets one job own one toast for its whole lifecycle instead
 * of firing three.
 */
export const toast = {
  show: (options: ToastOptions) => useToastStore.getState().show(options),
  update: (id: string, patch: Partial<ToastOptions>) => useToastStore.getState().update(id, patch),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  success: (title: ReactNode, options?: Omit<ToastOptions, 'title' | 'tone'>) =>
    useToastStore.getState().show({ ...options, title, tone: 'success' }),
  error: (title: ReactNode, options?: Omit<ToastOptions, 'title' | 'tone'>) =>
    useToastStore.getState().show({ ...options, title, tone: 'danger' }),
  warning: (title: ReactNode, options?: Omit<ToastOptions, 'title' | 'tone'>) =>
    useToastStore.getState().show({ ...options, title, tone: 'warning' }),
  info: (title: ReactNode, options?: Omit<ToastOptions, 'title' | 'tone'>) =>
    useToastStore.getState().show({ ...options, title, tone: 'neutral' })
}

/** Pause every running timer while the stack is hovered or focused. */
export function pauseToastTimers(): void {
  for (const id of Array.from(timers.keys())) clearTimer(id)
}

export function resumeToastTimers(): void {
  const state = useToastStore.getState()
  for (const record of state.toasts) {
    scheduleDismiss(record.id, record, () => useToastStore.getState())
  }
}
