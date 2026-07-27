// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { resetAppActions, runAppAction } from '@renderer/lib/app-actions'
import { useUIStore } from '@renderer/store/ui-store'
import { SSHFileEditor } from './SSHFileEditor'

// Monaco needs a worker and a layout engine; what is under test here is the
// toolbar, the dirty state and the discard confirmation.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange?: (next: string) => void }) => (
    <textarea data-testid="editor" value={value} onChange={(event) => onChange?.(event.target.value)} />
  )
}))

const { readFileMock, writeFileMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  writeFileMock: vi.fn()
}))

vi.mock('@renderer/lib/api', () => ({
  api: { ssh: { readFile: readFileMock, writeFile: writeFileMock } },
  unwrap: async <T,>(value: Promise<T> | T): Promise<T> => await value
}))

const tabId = 'ssh-editor:conn-1:/var/www/.env'

afterEach(() => {
  cleanup()
  resetAppActions()
  vi.restoreAllMocks()
})

describe('SSHFileEditor', () => {
  let originalShowToast: ReturnType<typeof useUIStore.getState>['showToast']

  beforeEach(() => {
    useI18nStore.getState().setLocale('en')
    readFileMock.mockReset()
    writeFileMock.mockReset()
    readFileMock.mockResolvedValue({ content: 'APP_ENV=prod' })
    writeFileMock.mockResolvedValue({ canceled: false })

    originalShowToast = useUIStore.getState().showToast
    useUIStore.setState({
      showToast: vi.fn(),
      workspaceTabs: [
        {
          id: tabId,
          title: '.env',
          view: { kind: 'ssh-editor', connectionId: 'conn-1', connectionName: 'prod', path: '/var/www/.env' }
        }
      ],
      activeTabId: tabId
    })
  })

  afterEach(() => {
    useUIStore.setState({
      showToast: originalShowToast,
      workspaceTabs: [],
      activeTabId: null,
      rightView: { kind: 'empty' }
    })
  })

  it('saves through the visible Save button and through ⌘S', async () => {
    render(<SSHFileEditor connectionId="conn-1" connectionName="prod" remotePath="/var/www/.env" />)

    const editor = await screen.findByTestId('editor')
    expect(screen.getByText('Saved')).toBeTruthy()

    fireEvent.change(editor, { target: { value: 'APP_ENV=staging' } })
    expect(screen.getByText('Unsaved changes')).toBeTruthy()

    // ⌘S is a global key with a per-view target (`lib/app-actions.ts`).
    act(() => {
      expect(runAppAction('save')).toBe(true)
    })

    await waitFor(() =>
      expect(writeFileMock).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        remotePath: '/var/www/.env',
        content: 'APP_ENV=staging'
      })
    )
  })

  it('guards a dirty close with the shared ConfirmDialog, not window.confirm', async () => {
    const nativeConfirm = vi.fn(() => true)
    vi.stubGlobal('confirm', nativeConfirm)

    render(<SSHFileEditor connectionId="conn-1" connectionName="prod" remotePath="/var/www/.env" />)

    const editor = await screen.findByTestId('editor')
    fireEvent.change(editor, { target: { value: 'APP_ENV=staging' } })

    act(() => useUIStore.getState().closeTab(tabId))

    expect(await screen.findByText('Discard unsaved changes?')).toBeTruthy()
    expect(useUIStore.getState().workspaceTabs).toHaveLength(1)
    expect(nativeConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))

    await waitFor(() => expect(useUIStore.getState().workspaceTabs).toHaveLength(0))

    vi.unstubAllGlobals()
  })

  it('reports the tab as unsaved to a path retarget without prompting', async () => {
    render(<SSHFileEditor connectionId="conn-1" connectionName="prod" remotePath="/var/www/.env" />)

    const editor = await screen.findByTestId('editor')
    expect(useUIStore.getState().hasUnsavedSSHPathTabs('conn-1', '/var/www')).toBe(false)

    fireEvent.change(editor, { target: { value: 'APP_ENV=staging' } })

    // `check` must not open a dialog — the file manager owns that confirmation.
    expect(useUIStore.getState().hasUnsavedSSHPathTabs('conn-1', '/var/www')).toBe(true)
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull()
  })
})
