// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { THEME_STORAGE_KEY, useThemeStore } from '@renderer/theme'
import { SidebarAppMenu } from './SidebarAppMenu'

afterEach(cleanup)

describe('SidebarAppMenu theme controls', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useI18nStore.getState().setLocale('en')
    useThemeStore.getState().setTheme('dark')
  })

  it('switches between light and dark themes', () => {
    render(<SidebarAppMenu />)

    fireEvent.click(screen.getByRole('button', { name: 'App menu' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Light' }))

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })
})
