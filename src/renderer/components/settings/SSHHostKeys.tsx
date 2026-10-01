import { useRef, useState } from 'react'
import { api, unwrap } from '@renderer/lib/api'
import { useI18n } from '@renderer/i18n'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { useUIStore } from '@renderer/store/ui-store'
import type { TrustedHostKey } from '../../../shared/app-api'

export function SSHHostKeys() {
  const { t } = useI18n()
  const showToast = useUIStore((s) => s.showToast)
  const [open, setOpen] = useState(false)
  const [keys, setKeys] = useState<TrustedHostKey[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const loadId = useRef(0)
  const load = async () => {
    const requestId = ++loadId.current
    setBusy(true); setError(null)
    try {
      const next = await unwrap(api.ssh.listHostKeys())
      if (requestId === loadId.current) setKeys(next)
    }
    catch (e) { if (requestId === loadId.current) setError((e as Error).message) }
    finally { if (requestId === loadId.current) setBusy(false) }
  }
  return <>
    <Button size="sm" onClick={() => { setOpen(true); void load() }}>{t('settings.connections.sshHostKeys')}</Button>
    <Dialog open={open} onOpenChange={setOpen} title={t('settings.connections.sshHostKeys')} description={t('settings.connections.sshHostKeysHint')}>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {busy ? <p>{t('common.loading')}</p> : keys.length === 0 ? <p className="text-sm text-fg-muted">{t('settings.connections.noHostKeys')}</p> :
        <ul className="space-y-2 max-h-80 overflow-auto">{keys.map((key) => <li key={`${key.host}:${key.port}`} className="rounded border border-border p-2">
          <div className="font-mono text-sm">{key.host}:{key.port}</div>
          <code className="break-all text-xs">{key.fingerprint}</code>
          <div><Button size="xs" variant="danger-ghost" disabled={removing !== null} loading={removing === `${key.host}:${key.port}`} onClick={async () => {
            setRemoving(`${key.host}:${key.port}`)
            try { if (await unwrap(api.ssh.forgetHostKey(key.host, key.port, key.fingerprint))) await load() }
            catch (e) { showToast((e as Error).message, 'error') }
            finally { setRemoving(null) }
          }}>{t('settings.connections.forgetHostKey')}</Button></div>
        </li>)}</ul>}
    </Dialog>
  </>
}
