import { useCallback, useEffect, useRef, useState } from 'react'
import { api, unwrap } from '@renderer/lib/api'
import { useUIStore } from '@renderer/store/ui-store'
import type { SSHFileEntry, SSHListFilesResult } from '../../../shared/types'

/**
 * Owns remote directory navigation and its race protection.
 * Mutating file actions stay in the feature controller and refresh through
 * `loadFiles`, so this hook has one responsibility: the current listing.
 */
export function useSSHFileListing(connectionId: string) {
  const showToast = useUIStore((state) => state.showToast)
  const [currentPath, setCurrentPath] = useState('.')
  const [pathDraft, setPathDraft] = useState('.')
  const [editingPath, setEditingPath] = useState(false)
  const [listing, setListing] = useState<SSHListFilesResult | null>(null)
  const [selected, setSelected] = useState<SSHFileEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const requestSeq = useRef(0)

  const loadFiles = useCallback(async (path: string) => {
    const requestId = requestSeq.current + 1
    requestSeq.current = requestId
    setLoading(true)
    try {
      const result = await unwrap(api.ssh.listFiles({ connectionId, path }))
      if (requestSeq.current !== requestId) return
      setListing(result)
      setLoadError(null)
      setCurrentPath(result.path)
      setPathDraft(result.path)
      setEditingPath(false)
      setSelected(null)
    } catch (error) {
      if (requestSeq.current !== requestId) return
      setLoadError(error as Error)
      showToast((error as Error).message, 'error')
    } finally {
      if (requestSeq.current === requestId) setLoading(false)
    }
  }, [connectionId, showToast])

  useEffect(() => {
    void loadFiles('.')
  }, [loadFiles])

  return {
    currentPath,
    pathDraft,
    setPathDraft,
    editingPath,
    setEditingPath,
    listing,
    selected,
    setSelected,
    loading,
    loadError,
    loadFiles
  }
}
