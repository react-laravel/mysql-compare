import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jobs, selectActiveJobs, selectJobsForTab, useJobStore } from './job-store'

describe('job-store', () => {
  beforeEach(() => {
    useJobStore.setState({ jobs: new Map() })
  })

  it('starts a job as running and returns its id', () => {
    const id = jobs.start({ kind: 'compare', label: 'Comparing shop' })

    const job = jobs.get(id)!
    expect(job.status).toBe('running')
    expect(job.kind).toBe('compare')
    expect(job.startedAt).toBeGreaterThan(0)
    expect(job.endedAt).toBeUndefined()
  })

  it('honours an explicit id and a queued start', () => {
    const id = jobs.start({ id: 'sync:1', kind: 'sync', label: 'Sync', status: 'queued' })

    expect(id).toBe('sync:1')
    expect(jobs.get('sync:1')!.status).toBe('queued')
  })

  it('merges progress patches while the job is live', () => {
    const id = jobs.start({ kind: 'export', label: 'Export' })
    jobs.update(id, { count: { done: 3, total: 40 }, detail: 'orders' })

    expect(jobs.get(id)).toMatchObject({ count: { done: 3, total: 40 }, detail: 'orders' })
  })

  it('ignores patches once the job is finished', () => {
    const id = jobs.start({ kind: 'export', label: 'Export' })
    jobs.finish(id)
    jobs.update(id, { detail: 'too late' })

    expect(jobs.get(id)!.detail).toBeUndefined()
    expect(jobs.get(id)!.status).toBe('done')
  })

  it('drops the cancel affordance and stamps endedAt on finish', () => {
    const onCancel = vi.fn()
    const id = jobs.start({ kind: 'sync', label: 'Sync', onCancel })

    jobs.finish(id, { status: 'error', detail: 'ER_NO_SUCH_TABLE' })

    const job = jobs.get(id)!
    expect(job.status).toBe('error')
    expect(job.detail).toBe('ER_NO_SUCH_TABLE')
    expect(job.onCancel).toBeUndefined()
    expect(job.endedAt).toBeGreaterThan(0)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls the job own onCancel exactly once', () => {
    const onCancel = vi.fn()
    const id = jobs.start({ kind: 'compare', label: 'Compare', onCancel })

    jobs.cancel(id)
    jobs.cancel(id)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(jobs.get(id)!.status).toBe('cancelled')
  })

  it('selects by tab and by activity, oldest first', () => {
    const first = jobs.start({ kind: 'query', label: 'Query', tabId: 'sql:c1:shop' })
    const second = jobs.start({ kind: 'export', label: 'Export', tabId: 'sql:c1:shop' })
    jobs.start({ kind: 'sync', label: 'Sync', tabId: 'diff' })
    jobs.finish(second)

    const state = useJobStore.getState()
    expect(selectJobsForTab(state, 'sql:c1:shop').map((job) => job.id)).toEqual([first, second])
    expect(selectActiveJobs(state).map((job) => job.kind)).toEqual(['query', 'sync'])
  })

  it('clears finished jobs but keeps live ones', () => {
    const live = jobs.start({ kind: 'sync', label: 'Sync' })
    const done = jobs.start({ kind: 'export', label: 'Export' })
    jobs.finish(done)

    useJobStore.getState().clearFinished()

    expect(Array.from(useJobStore.getState().jobs.keys())).toEqual([live])
  })

  it('removes a single job', () => {
    const id = jobs.start({ kind: 'other', label: 'Whatever' })
    jobs.remove(id)

    expect(jobs.get(id)).toBeUndefined()
  })
})
