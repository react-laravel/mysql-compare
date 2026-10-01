// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18nStore } from '@renderer/i18n'
import { useUIStore } from '@renderer/store/ui-store'
import { SSHHostKeys } from './SSHHostKeys'

const { listMock, forgetMock } = vi.hoisted(() => ({ listMock: vi.fn(), forgetMock: vi.fn() }))
vi.mock('@renderer/lib/api', () => ({
  api: { ssh: { listHostKeys: listMock, forgetHostKey: forgetMock } },
  unwrap: async <T,>(value: Promise<T> | T): Promise<T> => await value
}))
const identity = { host: 'ssh.example.test', port: 2222, fingerprint: 'SHA256:confirmed-fingerprint' }

describe('SSH host identity settings', () => {
  let originalToast: ReturnType<typeof useUIStore.getState>['showToast']
  beforeEach(() => {
    useI18nStore.getState().setLocale('en')
    originalToast = useUIStore.getState().showToast
    useUIStore.setState({ showToast: vi.fn() })
    listMock.mockReset().mockResolvedValue([identity])
    forgetMock.mockReset().mockResolvedValue(false)
  })
  afterEach(() => {
    cleanup()
    useUIStore.setState({ showToast: originalToast })
  })
  async function open() {
    render(<SSHHostKeys />)
    fireEvent.click(screen.getByRole('button'))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('ssh.example.test:2222')
    return dialog
  }
  it('loads and displays the saved endpoint and fingerprint for inspection', async () => {
    const dialog = await open()
    expect(within(dialog).getByText(identity.fingerprint)).toBeTruthy()
    expect(listMock).toHaveBeenCalledTimes(1)
    expect(forgetMock).not.toHaveBeenCalled()
  })
  it('keeps the identity when native removal confirmation is canceled', async () => {
    const dialog = await open()
    fireEvent.click(within(dialog).getByRole('button', { name: /forget/i }))
    await waitFor(() => expect(forgetMock).toHaveBeenCalledWith(identity.host, identity.port, identity.fingerprint))
    expect(listMock).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByText(identity.fingerprint)).toBeTruthy()
  })
  it('refreshes the trust list only after the backend confirms removal', async () => {
    forgetMock.mockResolvedValue(true)
    const dialog = await open()
    listMock.mockResolvedValue([])
    fireEvent.click(within(dialog).getByRole('button', { name: /forget/i }))
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(within(dialog).queryByText(identity.fingerprint)).toBeNull())
  })
  it('retains the displayed identity and explains backend removal errors', async () => {
    forgetMock.mockRejectedValue(new Error('Saved SSH identity changed'))
    const dialog = await open()
    fireEvent.click(within(dialog).getByRole('button', { name: /forget/i }))
    await waitFor(() => expect(useUIStore.getState().showToast).toHaveBeenCalledWith('Saved SSH identity changed', 'error'))
    expect(within(dialog).getByText(identity.fingerprint)).toBeTruthy()
    expect(listMock).toHaveBeenCalledTimes(1)
  })
  it('shows a fixed error when damaged trust data prevents loading', async () => {
    listMock.mockRejectedValue(new Error('SSH_HOST_KEY_STORE_INVALID: Restore the saved trust file'))
    render(<SSHHostKeys />)
    fireEvent.click(screen.getByRole('button'))
    expect((await screen.findByRole('alert')).textContent).toContain('SSH_HOST_KEY_STORE_INVALID')
    expect(forgetMock).not.toHaveBeenCalled()
  })
  it('prevents repeated native removal prompts while confirmation is pending', async () => {
    let resolve!: (value: boolean) => void
    forgetMock.mockReturnValue(new Promise<boolean>((done) => { resolve = done }))
    const dialog = await open()
    const button = within(dialog).getByRole('button', { name: /forget/i }) as HTMLButtonElement
    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(forgetMock).toHaveBeenCalledTimes(1)
    await act(async () => resolve(false))
    expect(button.disabled).toBe(false)
    expect(listMock).toHaveBeenCalledTimes(1)
  })
  it('ignores an older list request after the fingerprint dialog is reopened', async () => {
    let resolve!: (value: typeof identity[]) => void
    listMock.mockReturnValueOnce(new Promise<typeof identity[]>((done) => { resolve = done }))
      .mockResolvedValueOnce([{ ...identity, fingerprint: 'SHA256:current' }])
    render(<SSHHostKeys />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button'))
    await screen.findByText('SHA256:current')
    await act(async () => resolve([identity]))
    expect(screen.queryByText(identity.fingerprint)).toBeNull()
    expect(screen.getByText('SHA256:current')).toBeTruthy()
  })
})
