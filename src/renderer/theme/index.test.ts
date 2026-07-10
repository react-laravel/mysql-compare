// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { initializeTheme, THEME_STORAGE_KEY, useThemeStore } from './index'

describe('theme store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.className = ''
    document.documentElement.style.colorScheme = ''
  })

  it('applies and persists the selected theme', () => {
    useThemeStore.getState().setTheme('light')

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')

    useThemeStore.getState().setTheme('dark')

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('restores the current store theme during application startup', () => {
    useThemeStore.setState({ theme: 'dark' })

    initializeTheme()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })
})
