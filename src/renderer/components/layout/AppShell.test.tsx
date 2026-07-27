// @vitest-environment jsdom
/**
 * The shell contract this chunk exists to deliver: a titlebar that surfaces
 * Diff & Sync, a ⌘K palette that works with **zero** tabs open, Settings behind
 * ⌘, and a sidebar that collapses to a rail.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// xterm probes for a 2D canvas while its module evaluates; jsdom has none.
// jsdom also ships no layout, hence no `scrollIntoView`.
vi.hoisted(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null })
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => {} })
})

import { bootstrapApi } from '@renderer/lib/api'
import { useI18nStore } from '@renderer/i18n'
import { resetAppActions } from '@renderer/lib/app-actions'
import { useJobStore } from '@renderer/store/job-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'
import { THEME_STORAGE_KEY, useThemeStore } from '@renderer/theme'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  beforeEach(async () => {
    window.localStorage.clear()
    delete (window as { api?: unknown }).api
    await bootstrapApi()
    resetAppActions()
    useI18nStore.getState().setLocale('en')
    useThemeStore.getState().setTheme('dark')
    useSidebarStore.getState().setCollapsed(false)
    useJobStore.setState({ jobs: new Map() })
    useUIStore.setState({ workspaceTabs: [], activeTabId: null, rightView: { kind: 'empty' } })
  })

  afterEach(cleanup)

  it('gives Diff & Sync a labeled top-level button', () => {
    render(<AppShell />)

    // Chunk 7 gave the empty workspace its own Diff & Sync card, so the
    // titlebar's button has to be addressed through the titlebar.
    const titlebar = screen.getByRole('banner')
    fireEvent.click(within(titlebar).getByRole('button', { name: 'Diff & Sync' }))

    expect(useUIStore.getState().rightView.kind).toBe('diff')
  })

  it('opens the command palette with no tabs open — the old quick switcher could not', () => {
    render(<AppShell />)
    expect(useUIStore.getState().workspaceTabs).toHaveLength(0)

    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    const palette = screen.getByRole('dialog', { name: 'Command palette' })
    expect(palette).toBeDefined()
    // Never empty: it lists actions even when nothing is open.
    expect(screen.getByRole('option', { name: /Open Diff & Sync/ })).toBeDefined()
  })

  it('runs a palette command', async () => {
    render(<AppShell />)
    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    fireEvent.click(screen.getByRole('option', { name: /Open Diff & Sync/ }))

    await waitFor(() => expect(useUIStore.getState().rightView.kind).toBe('diff'))
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
  })

  it('does not fire the shortcut-help key while typing', () => {
    render(<AppShell />)
    const search = screen.getByPlaceholderText('Search connection')

    fireEvent.keyDown(search, { key: '?' })
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()

    fireEvent.keyDown(window, { key: '?' })
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeDefined()
  })

  it('opens settings on ⌘, and switches the theme from Appearance', () => {
    render(<AppShell />)

    fireEvent.keyDown(window, { key: ',', metaKey: true })
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('collapses the sidebar to a rail on ⌘\\ and keeps the connections visible', async () => {
    render(<AppShell />)
    await screen.findByText('shop · production')

    fireEvent.keyDown(window, { key: '\\', metaKey: true })

    expect(useSidebarStore.getState().collapsed).toBe(true)
    const rail = screen.getByRole('navigation', { name: 'Connections (collapsed)' })
    // Blueprint risk 7: the rail must still say which connections exist.
    expect(rail.querySelectorAll('li').length).toBeGreaterThan(0)
  })

  it('focuses the sidebar search on ⌘⇧F, expanding the rail first', async () => {
    render(<AppShell />)
    useSidebarStore.getState().setCollapsed(true)

    fireEvent.keyDown(window, { key: 'F', metaKey: true, shiftKey: true })

    expect(useSidebarStore.getState().collapsed).toBe(false)
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByPlaceholderText('Search connection'))
    )
  })

  describe('with tabs open', () => {
    beforeEach(() => {
      const store = useUIStore.getState()
      store.setRightView({ kind: 'diff' })
      store.setRightView({ kind: 'sql', connectionId: 'c1', database: 'shop' })
      store.setRightView({ kind: 'table', connectionId: 'c1', database: 'shop', table: 'orders' })
    })

    it('cycles, jumps to and closes tabs', () => {
      render(<AppShell />)
      const ids = useUIStore.getState().workspaceTabs.map((tab) => tab.id)
      expect(useUIStore.getState().activeTabId).toBe(ids[2])

      fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true })
      expect(useUIStore.getState().activeTabId).toBe(ids[0])

      fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
      expect(useUIStore.getState().activeTabId).toBe(ids[2])

      fireEvent.keyDown(window, { key: '1', metaKey: true })
      expect(useUIStore.getState().activeTabId).toBe(ids[0])

      // ⌘9 is the last tab, as in every editor.
      fireEvent.keyDown(window, { key: '9', metaKey: true })
      expect(useUIStore.getState().activeTabId).toBe(ids[2])

      fireEvent.keyDown(window, { key: 'w', metaKey: true })
      expect(useUIStore.getState().workspaceTabs).toHaveLength(2)
    })

    it('lists the open tabs in the palette, which is what the quick switcher did', () => {
      render(<AppShell />)
      fireEvent.keyDown(window, { key: 'k', metaKey: true })

      expect(screen.getByRole('option', { name: /shop \/ orders/ })).toBeDefined()
    })
  })

  it('shows Ready in the status bar when nothing is running', () => {
    render(<AppShell />)
    expect(screen.getByRole('button', { name: 'Show background tasks' }).textContent).toContain(
      'Ready'
    )
  })

  it('surfaces a running job in the status bar with its own Cancel', () => {
    const onCancel = vi.fn()
    render(<AppShell />)

    act(() => {
      useJobStore.getState().start({
        id: 'compare:1',
        kind: 'compare',
        label: 'Comparing shop',
        count: { done: 12, total: 40 },
        onCancel
      })
    })

    const indicator = screen.getByRole('button', { name: 'Show background tasks' })
    expect(indicator.textContent).toContain('Comparing shop')
    expect(indicator.textContent).toContain('12/40')

    fireEvent.click(indicator)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(useJobStore.getState().jobs.get('compare:1')?.status).toBe('cancelled')
  })

  it('cancels the current view’s job on ⌘.', () => {
    const onCancel = vi.fn()
    render(<AppShell />)

    act(() => {
      useJobStore.getState().start({ id: 'export:1', kind: 'export', label: 'Export', onCancel })
    })
    fireEvent.keyDown(window, { key: '.', metaKey: true })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('lists the saved connections in Settings ▸ Connections', async () => {
    render(<AppShell />)
    await screen.findByText('shop · production')

    fireEvent.keyDown(window, { key: ',', metaKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Connections' }))

    expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0)
  })
})
