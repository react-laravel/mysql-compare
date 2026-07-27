// @vitest-environment jsdom

import * as React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Plus, Trash2 } from 'lucide-react'
import { Combobox } from './combobox'
import { CommandPalette, rankCommands, type Command } from './command-palette'
import { ConfirmDialog } from './confirm-dialog'
import { ContextMenu } from './context-menu'
import { DataTable, type Column } from './data-table'
import { Dialog } from './dialog'
import { DropdownMenu, type MenuItem } from './dropdown-menu'
import { EmptyState } from './empty-state'
import { IconButton } from './icon-button'
import { formatChord } from './kbd'
import { ProgressBar } from './progress-bar'
import { SearchInput } from './search-input'
import { SplitPane } from './split-pane'
import { Button } from './button'

afterEach(cleanup)

describe('IconButton', () => {
  it('turns its required label into the accessible name', () => {
    render(<IconButton icon={Plus} label="New connection" />)
    expect(screen.getByRole('button', { name: 'New connection' })).toBeTruthy()
  })
})

describe('DropdownMenu', () => {
  const items: MenuItem[] = [
    { id: 'open', label: 'Open', onSelect: vi.fn() },
    { id: 'drop', label: 'Drop table', danger: true, icon: Trash2, onSelect: vi.fn() }
  ]

  it('renders menu semantics and a separator before the first danger item', () => {
    render(<DropdownMenu items={items} open aria-label="Table actions" />)

    expect(screen.getByRole('menu', { name: 'Table actions' })).toBeTruthy()
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
    expect(screen.getAllByRole('separator')).toHaveLength(1)
  })

  it('moves the active row with the arrow keys and activates with Enter', () => {
    const onSelect = vi.fn()
    render(
      <DropdownMenu
        open
        aria-label="Table actions"
        items={[
          { id: 'a', label: 'First', onSelect: vi.fn() },
          { id: 'b', label: 'Second', onSelect }
        ]}
      />
    )

    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('does not execute a disabled item', () => {
    const onSelect = vi.fn()
    render(
      <DropdownMenu
        open
        aria-label="Table actions"
        items={[{ id: 'a', label: 'Nope', disabled: true, disabledReason: 'no PK', onSelect }]}
      />
    )

    fireEvent.click(screen.getByRole('menuitem', { name: 'Nope' }))
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('ContextMenu', () => {
  it('renders nothing until it has a pointer anchor', () => {
    const { rerender } = render(
      <ContextMenu items={[{ id: 'a', label: 'Copy', onSelect: vi.fn() }]} at={null} onClose={vi.fn()} />
    )
    expect(screen.queryByRole('menu')).toBeNull()

    rerender(
      <ContextMenu
        items={[{ id: 'a', label: 'Copy', onSelect: vi.fn() }]}
        at={{ x: 40, y: 60 }}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('clamps its position inside the viewport instead of trusting the pointer', () => {
    render(
      <ContextMenu
        items={[{ id: 'a', label: 'Copy', onSelect: vi.fn() }]}
        at={{ x: 99999, y: 99999 }}
        onClose={vi.fn()}
      />
    )

    // the popover shell carries the computed position
    const surface = screen.getByRole('menu').parentElement as HTMLElement
    expect(Number.parseInt(surface.style.left, 10)).toBeLessThanOrEqual(window.innerWidth)
    expect(Number.parseInt(surface.style.top, 10)).toBeLessThanOrEqual(window.innerHeight)
  })
})

describe('ConfirmDialog', () => {
  it('focuses Cancel, not the destructive action', async () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Drop table"
        cancelLabel="Cancel"
        confirmLabel="Drop"
        onConfirm={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    )
  })

  it('gates the confirm button behind the typed confirmation', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Drop database"
        requireTypedConfirmation="shop"
        typedConfirmationHint="Type shop"
        cancelLabel="Cancel"
        confirmLabel="Drop"
        onConfirm={onConfirm}
      />
    )

    const confirm = screen.getByRole('button', { name: 'Drop' })
    expect(confirm.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('shop'), { target: { value: 'shop' } })
    expect(screen.getByRole('button', { name: 'Drop' }).hasAttribute('disabled')).toBe(false)
  })

  it('has an aria-modal dialog with a labelled title', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Truncate table"
        cancelLabel="Cancel"
        confirmLabel="Truncate"
        onConfirm={vi.fn()}
      />
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
  })
})

describe('Escape layering', () => {
  function DialogWithMenu() {
    const [open, setOpen] = React.useState(true)
    return (
      <Dialog open={open} onOpenChange={setOpen} title="Outer dialog">
        <DropdownMenu
          items={[{ id: 'a', label: 'Alpha', onSelect: vi.fn() }]}
          aria-label="Inner menu"
          trigger={<Button>Open menu</Button>}
        />
      </Dialog>
    )
  }

  it('closes only the topmost layer', () => {
    render(<DialogWithMenu />)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByRole('menu')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lets a search field consume Escape before the surrounding dialog does', () => {
    function DialogWithSearch() {
      const [open, setOpen] = React.useState(true)
      const [value, setValue] = React.useState('users')
      return (
        <Dialog open={open} onOpenChange={setOpen} title="Filter">
          <SearchInput value={value} onValueChange={setValue} clearLabel="Clear" />
        </Dialog>
      )
    }

    render(<DialogWithSearch />)
    const input = screen.getByRole('searchbox')
    input.focus()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('dialog')).toBeTruthy()
  })
})

describe('SearchInput', () => {
  function Harness({ onClear }: { onClear?: () => void }) {
    const [value, setValue] = React.useState('status = 1')
    return (
      <SearchInput value={value} onValueChange={setValue} onClear={onClear} clearLabel="Clear" />
    )
  }

  it('clears on Escape and blurs on the second Escape', () => {
    render(<Harness />)
    const input = screen.getByRole('searchbox')
    input.focus()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect((input as HTMLInputElement).value).toBe('')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(document.activeElement).not.toBe(input)
  })

  it('routes the clear affordance through onClear when provided', () => {
    const onClear = vi.fn()
    render(<Harness onClear={onClear} />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})

describe('ProgressBar', () => {
  it('reports a determinate value and offers Cancel next to the progress', () => {
    const onCancel = vi.fn()
    render(
      <ProgressBar
        status="running"
        count={{ done: 12, total: 40 }}
        label="Comparing"
        onCancel={onCancel}
        cancelLabel="Cancel"
      />
    )

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('30')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('is indeterminate while running without a total', () => {
    render(<ProgressBar status="running" label="Scanning" />)
    const bar = screen.getByRole('progressbar')
    expect(bar.hasAttribute('aria-valuenow')).toBe(false)
    expect(bar.getAttribute('aria-busy')).toBe('true')
  })
})

describe('EmptyState', () => {
  it('always renders its action and exposes the error detail', () => {
    render(
      <EmptyState
        variant="error"
        title="Could not load"
        action={<Button>Retry</Button>}
        error={new Error('connection refused')}
        detailsLabel="Details"
      />
    )

    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByText('Details')).toBeTruthy()
  })
})

describe('DataTable', () => {
  interface Row {
    id: string
    name: string
  }

  const columns: Column<Row>[] = [
    { id: 'name', header: 'Name', cell: (row) => row.name, sortable: true }
  ]
  const rows: Row[] = [
    { id: '1', name: 'orders' },
    { id: '2', name: 'users' }
  ]

  it('activates a row with a click, Enter and Space', () => {
    const onRowActivate = vi.fn()
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        onRowActivate={onRowActivate}
        aria-label="Tables"
      />
    )

    const [first] = screen.getAllByRole('row').slice(1)
    if (!first) throw new Error('expected a body row')
    fireEvent.click(first)
    fireEvent.keyDown(first, { key: 'Enter' })
    fireEvent.keyDown(first, { key: ' ' })
    expect(onRowActivate).toHaveBeenCalledTimes(3)
  })

  it('drives select-all through the indeterminate checkbox', () => {
    const onChange = vi.fn()
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        aria-label="Tables"
        selection={{
          selected: new Set(['1']),
          onChange,
          selectAllLabel: 'Select all'
        }}
      />
    )

    const selectAll = screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement
    expect(selectAll.indeterminate).toBe(true)

    fireEvent.click(selectAll)
    expect(onChange).toHaveBeenCalledWith(new Set(['1', '2']))
  })

  it('cycles the sort direction asc → desc → none', () => {
    const onSortChange = vi.fn()
    const { rerender } = render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        aria-label="Tables"
        sort={null}
        onSortChange={onSortChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Name/ }))
    expect(onSortChange).toHaveBeenLastCalledWith({ columnId: 'name', direction: 'asc' })

    rerender(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        aria-label="Tables"
        sort={{ columnId: 'name', direction: 'desc' }}
        onSortChange={onSortChange}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Name/ }))
    expect(onSortChange).toHaveBeenLastCalledWith(null)
  })
})

describe('SplitPane', () => {
  it('exposes a keyboard-resizable separator', () => {
    // jsdom has no layout, so the container reports 0px without this.
    const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 800
    })

    render(
      <SplitPane label="Resize sidebar" min={100} max={600} defaultRatio={0.5}>
        <div>left</div>
        <div>right</div>
      </SplitPane>
    )

    const separator = screen.getByRole('separator', { name: 'Resize sidebar' })
    expect(separator.getAttribute('aria-valuemin')).toBe('100')
    expect(separator.getAttribute('tabindex')).toBe('0')

    const before = separator.getAttribute('aria-valuenow')
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(separator.getAttribute('aria-valuenow')).not.toBe(before)

    if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
  })

  it('folds the second pane when collapsible="second"', () => {
    const onCollapsedChange = vi.fn()
    const { rerender, container } = render(
      <SplitPane
        direction="vertical"
        label="Resize editor"
        collapsible="second"
        collapsedSize={0}
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
      >
        <div>editor</div>
        <div>results</div>
      </SplitPane>
    )

    const panes = () => Array.from(container.firstElementChild?.children ?? [])
    expect((panes()[2] as HTMLElement).style.height).toBe('')

    rerender(
      <SplitPane
        direction="vertical"
        label="Resize editor"
        collapsible="second"
        collapsedSize={0}
        collapsed
        onCollapsedChange={onCollapsedChange}
      >
        <div>editor</div>
        <div>results</div>
      </SplitPane>
    )

    // The *second* pane folds; the first keeps rendering its content.
    expect((panes()[2] as HTMLElement).style.height).toBe('0px')
    expect((panes()[0] as HTMLElement).style.height).toBe('')
    expect(screen.getByText('editor')).toBeTruthy()

    // Enter on the separator is the way back out.
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize editor' }), { key: 'Enter' })
    expect(onCollapsedChange).toHaveBeenCalledWith(false)
  })
})

describe('CommandPalette', () => {
  const commands: Command[] = [
    { id: 'diff', title: 'Open Diff & Sync', group: 'navigate', perform: vi.fn() },
    { id: 'tab', title: 'shop / orders', group: 'open', recentAt: 2, perform: vi.fn() },
    { id: 'set', title: 'Settings', group: 'settings', perform: vi.fn() }
  ]

  it('is never empty with an empty query', () => {
    render(<CommandPalette open onOpenChange={vi.fn()} commands={commands} />)
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('filters on every query token', () => {
    expect(rankCommands(commands, 'diff sync').map((c) => c.id)).toEqual(['diff'])
    expect(rankCommands(commands, 'zzz')).toHaveLength(0)
  })

  it('runs the highlighted command on Enter', () => {
    const perform = vi.fn()
    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        commands={[{ id: 'x', title: 'Run me', group: 'action', perform }]}
      />
    )

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(perform).toHaveBeenCalledTimes(1)
  })
})

describe('Combobox', () => {
  const items = [
    { id: 'a', label: 'prod / shop' },
    { id: 'b', label: 'staging / shop' }
  ]

  it('filters and commits a selection without nesting buttons', () => {
    const onValueChange = vi.fn()
    render(
      <Combobox
        items={items}
        value={null}
        onValueChange={onValueChange}
        itemKey={(item) => item.id}
        itemLabel={(item) => item.label}
        placeholder="Pick one"
        aria-label="Target database"
      />
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Target database' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'staging' } })

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    fireEvent.click(options[0] as HTMLElement)
    expect(onValueChange).toHaveBeenCalledWith(items[1])
  })

  it('offers a clear control that is not inside the trigger button', () => {
    const onValueChange = vi.fn()
    render(
      <Combobox
        items={items}
        value={items[0] ?? null}
        onValueChange={onValueChange}
        itemKey={(item) => item.id}
        itemLabel={(item) => item.label}
        clearable
        clearLabel="Clear"
        aria-label="Target database"
      />
    )

    const clear = screen.getByRole('button', { name: 'Clear' })
    expect(clear.closest('[role="combobox"]')).toBeNull()

    fireEvent.click(clear)
    expect(onValueChange).toHaveBeenCalledWith(null)
  })
})

describe('Kbd', () => {
  it('renders platform-appropriate chords', () => {
    expect(formatChord('Mod+K', true)).toBe('⌘K')
    expect(formatChord('Mod+K', false)).toBe('Ctrl+K')
  })
})
