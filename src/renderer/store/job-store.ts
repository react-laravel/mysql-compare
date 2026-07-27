// One home for every long-running job in the app.
//
// DESIGN-SYSTEM §7: `idle → queued → running → done | error | cancelled` is a
// shared vocabulary, not something each screen improvises. This store is the
// single source of that state; three surfaces read it and never invent their own:
//
//   1. `Toolbar.progress` — the job that owns the current view
//   2. the `TabStrip` tab status dot — a job that owns a tab you navigated away from
//   3. `AppStatusBar` — every job, with per-job Cancel in its popover
//
// §7.2 also says: never more than one tier for the same job at the same time.
// `tabId` is what lets a surface decide whether a job is "mine".
import { create } from 'zustand'
import type { ReactNode } from 'react'
import type { JobStatus, ProgressState } from '@renderer/components/ui/progress-bar'

export type { JobStatus, ProgressState }

/**
 * What kind of work this is. Drives the icon and the grouping in the status-bar
 * job list; it is not a status.
 */
export type JobKind =
  | 'compare'
  | 'sync'
  | 'export'
  | 'import'
  | 'query'
  | 'transfer'
  | 'other'

export interface Job extends ProgressState {
  id: string
  kind: JobKind
  /** Human label, already translated by the caller. */
  label: ReactNode
  /** The workspace tab that owns this job, when one does. */
  tabId?: string
  startedAt: number
  endedAt?: number
}

export interface StartJobInput extends Omit<ProgressState, 'status'> {
  id?: string
  kind: JobKind
  label: ReactNode
  tabId?: string
  /** `queued` when the job is waiting on a slot; defaults to `running`. */
  status?: Extract<JobStatus, 'queued' | 'running'>
}

export type JobPatch = Partial<Omit<Job, 'id' | 'startedAt'>>

interface JobState {
  jobs: Map<string, Job>
  /** Registers a job and returns its id (generated when not supplied). */
  start: (input: StartJobInput) => string
  /** Merges a patch into a live job. A no-op once the job has finished. */
  update: (id: string, patch: JobPatch) => void
  /** Terminal transition. `done` by default; `error` carries a `detail`. */
  finish: (id: string, outcome?: { status?: Extract<JobStatus, 'done' | 'error' | 'cancelled'>; detail?: ReactNode }) => void
  /** Invokes the job's own `onCancel` and marks it cancelled. */
  cancel: (id: string) => void
  /** Forgets a job entirely (the status bar's "clear finished"). */
  remove: (id: string) => void
  clearFinished: () => void
}

const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>(['done', 'error', 'cancelled'])

export function isJobActive(job: Job): boolean {
  return !TERMINAL.has(job.status)
}

let sequence = 0

export const useJobStore = create<JobState>((set, get) => ({
  jobs: new Map(),

  start: (input) => {
    const id = input.id ?? `job-${++sequence}`
    const { status = 'running', ...rest } = input
    const job: Job = { ...rest, id, status, startedAt: Date.now() }

    set((state) => {
      const jobs = new Map(state.jobs)
      jobs.set(id, job)
      return { jobs }
    })

    return id
  },

  update: (id, patch) =>
    set((state) => {
      const job = state.jobs.get(id)
      if (!job || !isJobActive(job)) return state

      const jobs = new Map(state.jobs)
      jobs.set(id, { ...job, ...patch })
      return { jobs }
    }),

  finish: (id, outcome) =>
    set((state) => {
      const job = state.jobs.get(id)
      if (!job) return state

      const status = outcome?.status ?? 'done'
      const jobs = new Map(state.jobs)
      jobs.set(id, {
        ...job,
        status,
        detail: outcome?.detail ?? job.detail,
        // A finished job cannot be cancelled, so the affordance goes away with it.
        onCancel: undefined,
        endedAt: Date.now()
      })
      return { jobs }
    }),

  cancel: (id) => {
    const job = get().jobs.get(id)
    if (!job || !isJobActive(job)) return
    job.onCancel?.()
    get().finish(id, { status: 'cancelled' })
  },

  remove: (id) =>
    set((state) => {
      if (!state.jobs.has(id)) return state
      const jobs = new Map(state.jobs)
      jobs.delete(id)
      return { jobs }
    }),

  clearFinished: () =>
    set((state) => {
      const jobs = new Map<string, Job>()
      state.jobs.forEach((job, id) => {
        if (isJobActive(job)) jobs.set(id, job)
      })
      return jobs.size === state.jobs.size ? state : { jobs }
    })
}))

/** Imperative handle for non-React callers (API event streams, hooks). */
export const jobs = {
  start: (input: StartJobInput) => useJobStore.getState().start(input),
  update: (id: string, patch: JobPatch) => useJobStore.getState().update(id, patch),
  finish: (id: string, outcome?: Parameters<JobState['finish']>[1]) =>
    useJobStore.getState().finish(id, outcome),
  cancel: (id: string) => useJobStore.getState().cancel(id),
  remove: (id: string) => useJobStore.getState().remove(id),
  get: (id: string) => useJobStore.getState().jobs.get(id)
}

/** The jobs a given tab owns, oldest first. */
export function selectJobsForTab(state: { jobs: Map<string, Job> }, tabId: string): Job[] {
  return Array.from(state.jobs.values())
    .filter((job) => job.tabId === tabId)
    .sort((left, right) => left.startedAt - right.startedAt)
}

/** Everything still running or queued, oldest first — what the status bar shows. */
export function selectActiveJobs(state: { jobs: Map<string, Job> }): Job[] {
  return Array.from(state.jobs.values())
    .filter(isJobActive)
    .sort((left, right) => left.startedAt - right.startedAt)
}
