// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { ExportTableDialog } from './ExportTableDialog'

afterEach(cleanup)

describe('ExportTableDialog', () => {
  beforeEach(() => {
    useI18nStore.getState().setLocale('en')
  })

  it('defaults to selected rows when the dialog opens with a row selection', () => {
    render(
      <ExportTableDialog
        open
        onOpenChange={() => undefined}
        connectionId="conn-1"
        database="rpg"
        table="users"
        selectedRows={[{ id: 1, name: 'Admin' }]}
        availableScopes={['all', 'filtered', 'page', 'selected']}
      />
    )

    expect((screen.getByRole('combobox', { name: 'Scope' }) as HTMLSelectElement).value).toBe(
      'selected'
    )
  })

  it('defaults to the full table when no rows are selected', () => {
    render(
      <ExportTableDialog
        open
        onOpenChange={() => undefined}
        connectionId="conn-1"
        database="rpg"
        table="users"
        availableScopes={['all', 'filtered', 'page']}
      />
    )

    expect((screen.getByRole('combobox', { name: 'Scope' }) as HTMLSelectElement).value).toBe('all')
  })
})
