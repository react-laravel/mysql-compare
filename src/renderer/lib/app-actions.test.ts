import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hasAppAction,
  registerAppAction,
  resetAppActions,
  runAppAction
} from './app-actions'

afterEach(resetAppActions)

describe('app action bus', () => {
  it('reports nothing claimed until a view registers', () => {
    expect(hasAppAction('focus-filter')).toBe(false)
    expect(runAppAction('focus-filter')).toBe(false)
  })

  it('routes to the most recently registered handler', () => {
    const first = vi.fn()
    const second = vi.fn()
    registerAppAction('refresh-view', first)
    registerAppAction('refresh-view', second)

    expect(runAppAction('refresh-view')).toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('falls back to the handler underneath when the top one unregisters', () => {
    const view = vi.fn()
    const overlay = vi.fn()
    registerAppAction('save', view)
    const dispose = registerAppAction('save', overlay)

    dispose()
    runAppAction('save')

    expect(view).toHaveBeenCalledTimes(1)
    expect(overlay).not.toHaveBeenCalled()
  })

  it('forgets an id once its last handler is gone', () => {
    const dispose = registerAppAction('toggle-bottom-panel', () => {})
    dispose()
    expect(hasAppAction('toggle-bottom-panel')).toBe(false)
  })
})
