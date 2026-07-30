import { lazy, Suspense, type ComponentProps } from 'react'
import type Editor from '@monaco-editor/react'
import type { OnMount } from '@monaco-editor/react'

export type { OnMount }

type MonacoEditorProps = ComponentProps<typeof Editor>

/**
 * Monaco is several megabytes including its language services. Configure and
 * load it only when an editor tab is actually rendered, rather than delaying
 * every database-browsing session at application startup.
 */
const LazyEditor = lazy(async () => {
  // JSDOM has no Worker implementation; the editor package is mocked in
  // component tests, so worker/bootstrap configuration belongs to runtime.
  if (import.meta.env.MODE !== 'test') await import('@renderer/monaco')
  return import('@monaco-editor/react')
})

export function MonacoEditor(props: MonacoEditorProps) {
  return (
    <Suspense
      fallback={
        <div
          className="h-full min-h-24 animate-pulse bg-surface-2"
          aria-label="Loading editor"
          aria-busy
        />
      }
    >
      <LazyEditor {...props} />
    </Suspense>
  )
}
