import { useState, type ReactNode } from 'react'

/** Mount on first use, then retain editing/scroll state while hidden. */
export function RetainedView({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active)
  if (active && !visited) setVisited(true)
  if (!active && !visited) return null
  return <div className={active ? 'flex h-full min-h-0 flex-col' : 'hidden'}>{children}</div>
}
