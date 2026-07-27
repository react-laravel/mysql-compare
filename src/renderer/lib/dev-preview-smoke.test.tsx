// @vitest-environment jsdom
/**
 * Proves what Chunk 2 exists to deliver: outside the Tauri runtime,
 * `bootstrapApi()` installs the dev mock instead of throwing, and the real app
 * shell mounts and paints mock data. This is the CI-checkable half of
 * "`npm run dev:ui` renders the app in a plain browser".
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// xterm probes for a 2D canvas while its module evaluates; jsdom has none.
// Hoisted so it runs before the `App` import chain pulls xterm in.
vi.hoisted(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null })
})

import App from '../App'
import { bootstrapApi } from './api'

describe('browser dev preview', () => {
  beforeEach(async () => {
    delete (window as { api?: unknown }).api
    await bootstrapApi()
  })

  afterEach(() => {
    cleanup()
  })

  it('bootstraps without the Tauri runtime', () => {
    expect('__TAURI_INTERNALS__' in window).toBe(false)
    expect(window.api).toBeDefined()
    expect(window.api.runtime.mode).toBe('web')
  })

  it('mounts the shell and lists the mock connections', async () => {
    render(<App />)
    expect(await screen.findByText('shop · production')).toBeDefined()
    expect(await screen.findByText('analytics · warehouse')).toBeDefined()
    expect(await screen.findByText('cache · edge')).toBeDefined()
  })
})
