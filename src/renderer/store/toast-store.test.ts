import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast, useToastStore } from './toast-store'

describe('toast-store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.getState().clear()
  })

  afterEach(() => {
    useToastStore.getState().clear()
    vi.useRealTimers()
  })

  it('stacks toasts instead of replacing the previous one', () => {
    toast.info('first')
    toast.info('second')

    expect(useToastStore.getState().toasts.map((entry) => entry.title)).toEqual([
      'first',
      'second'
    ])
  })

  it('auto-dismisses a neutral toast after the default duration', () => {
    toast.info('transient')
    expect(useToastStore.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(4000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('keeps a danger toast until it is dismissed', () => {
    const id = toast.error('boom')

    vi.advanceTimersByTime(60_000)
    expect(useToastStore.getState().toasts).toHaveLength(1)

    toast.dismiss(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('lets one job own one toast across its lifecycle', () => {
    const id = toast.show({ id: 'job-1', title: 'Queued', tone: 'neutral' })
    toast.update(id, { title: 'Running', durationMs: null })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(60_000)
    expect(useToastStore.getState().toasts[0]?.title).toBe('Running')

    toast.update(id, { title: 'Done', tone: 'success', durationMs: 1000 })
    vi.advanceTimersByTime(1000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('reuses the slot when the same explicit id is shown twice', () => {
    toast.show({ id: 'same', title: 'one' })
    toast.show({ id: 'same', title: 'two' })

    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.title).toBe('two')
  })
})
