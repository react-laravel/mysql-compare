// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { RetainedView } from './RetainedView'

afterEach(cleanup)
it('does not load an unvisited view and retains its local state after activation', () => {
  const load = vi.fn()
  function View() {
    const [value, setValue] = useState('')
    useEffect(load, [])
    return <input aria-label="filter" value={value} onChange={(event) => setValue(event.target.value)} />
  }
  const view = render(<RetainedView active={false}><View /></RetainedView>)
  expect(load).not.toHaveBeenCalled()
  view.rerender(<RetainedView active><View /></RetainedView>)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'id > 10' } })
  view.rerender(<RetainedView active={false}><View /></RetainedView>)
  view.rerender(<RetainedView active><View /></RetainedView>)
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('id > 10')
  expect(load).toHaveBeenCalledTimes(1)
})
