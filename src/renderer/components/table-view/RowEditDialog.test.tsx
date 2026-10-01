// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RowEditDialog } from './RowEditDialog'
import { testColumns, setEnglishLocale } from './table-data-test-helpers'

beforeEach(setEnglishLocale)
afterEach(cleanup)

it('does not render or overwrite columns omitted by the data projection', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  render(<RowEditDialog mode="edit" columns={testColumns} primaryKey={['id']} row={{ id: 1, name: 'Alice' }} onClose={vi.fn()} onSubmit={onSubmit} />)
  expect(screen.queryByText('active')).toBeNull()
  fireEvent.change(screen.getByDisplayValue('Alice'), { target: { value: 'Bob' } })
  fireEvent.click(screen.getByRole('button', { name: 'Update' }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'Bob' }, { id: 1 }))
})
