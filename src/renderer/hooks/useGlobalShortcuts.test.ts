// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Job } from '@renderer/store/job-store'
import { isEditableTarget, pickCancellableJob } from './useGlobalShortcuts'

function job(id: string, patch: Partial<Job> = {}): Job {
  return {
    id,
    kind: 'compare',
    label: id,
    status: 'running',
    startedAt: 0,
    ...patch
  }
}

function jobMap(...list: Job[]): Map<string, Job> {
  return new Map(list.map((entry) => [entry.id, entry]))
}

describe('isEditableTarget', () => {
  it('recognises the three form elements and contenteditable', () => {
    for (const tag of ['input', 'textarea', 'select'] as const) {
      expect(isEditableTarget(document.createElement(tag))).toBe(true)
    }
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    expect(isEditableTarget(editable)).toBe(true)
  })

  it('leaves everything else alone', () => {
    expect(isEditableTarget(document.createElement('button'))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('pickCancellableJob', () => {
  it('returns nothing when no job is live', () => {
    expect(pickCancellableJob(jobMap(job('a', { status: 'done' })), 'tab-1')).toBeNull()
  })

  it('prefers the job owned by the active tab', () => {
    const jobs = jobMap(
      job('older', { startedAt: 1 }),
      job('mine', { startedAt: 2, tabId: 'tab-1' })
    )
    expect(pickCancellableJob(jobs, 'tab-1')?.id).toBe('mine')
  })

  it('falls back to the oldest running job when the tab owns none', () => {
    const jobs = jobMap(job('newer', { startedAt: 5 }), job('older', { startedAt: 1 }))
    expect(pickCancellableJob(jobs, 'tab-1')?.id).toBe('older')
  })

  it('never returns a finished job', () => {
    const jobs = jobMap(
      job('cancelled', { startedAt: 1, status: 'cancelled', tabId: 'tab-1' }),
      job('live', { startedAt: 9 })
    )
    expect(pickCancellableJob(jobs, 'tab-1')?.id).toBe('live')
  })
})
