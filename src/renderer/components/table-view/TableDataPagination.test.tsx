// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TableDataPagination } from './TableDataPagination'
import { setEnglishLocale } from './table-data-test-helpers'

afterEach(cleanup)

function createProps(overrides: Partial<React.ComponentProps<typeof TableDataPagination>> = {}) {
  return {
    totalRows: 320,
    page: 2,
    totalPages: 4,
    pageDraft: '2',
    hiddenColumnCount: 2,
    onGoToPage: vi.fn(),
    onPageDraftChange: vi.fn(),
    onSubmitPageDraft: vi.fn(),
    onResetPageDraft: vi.fn(),
    ...overrides
  }
}

describe('TableDataPagination', () => {
  beforeEach(() => {
    setEnglishLocale()
  })

  it('wires the paging buttons and the page draft interactions', () => {
    const props = createProps()

    render(<TableDataPagination {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Prev' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    const pageInput = screen.getByLabelText('Page number')
    fireEvent.change(pageInput, { target: { value: '4' } })
    fireEvent.blur(pageInput)
    fireEvent.keyDown(pageInput, { key: 'Escape' })

    expect(screen.getByText('2 hidden')).toBeTruthy()
    expect(props.onGoToPage).toHaveBeenNthCalledWith(1, 1)
    expect(props.onGoToPage).toHaveBeenNthCalledWith(2, 3)
    expect(props.onPageDraftChange).toHaveBeenCalledWith('4')
    expect(props.onSubmitPageDraft).toHaveBeenCalledTimes(1)
    expect(props.onResetPageDraft).toHaveBeenCalledTimes(1)
  })

  // The page-size control moved into the toolbar `⋯`; the guard that every
  // `PAGE_SIZE_OPTIONS` value is offerable moved with it (TableDataToolbar and
  // TableCompareToolbar tests).

  it('disables navigation buttons at the edges', () => {
    render(<TableDataPagination {...createProps({ page: 1, totalPages: 1, hiddenColumnCount: 0 })} />)

    const prevButton = screen.getByRole('button', { name: 'Prev' })
    const nextButton = screen.getByRole('button', { name: 'Next' })

    expect((prevButton as HTMLButtonElement).disabled).toBe(true)
    expect((nextButton as HTMLButtonElement).disabled).toBe(true)
  })

  it('cancels a focused page draft without submitting it on blur', () => {
    const props = createProps({ pageDraft: '4' })
    render(<TableDataPagination {...props} />)
    const input = screen.getByLabelText('Page number')
    input.focus()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(props.onResetPageDraft).toHaveBeenCalledOnce()
    expect(props.onSubmitPageDraft).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(input)

    input.focus()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onSubmitPageDraft).toHaveBeenCalledOnce()
  })

  it('shows the range of rows on the current page', () => {
    render(<TableDataPagination {...createProps({ pageSize: 100, page: 4, pageDraft: '4' })} />)
    expect(screen.getByText('301–320 of 320 rows')).toBeTruthy()
  })
})
