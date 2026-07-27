// 仅展示用的小型辅助组件，原本散落在 DiffPanel.tsx 内部，统一放这里方便复用。
//
// Blueprint §3.5: the local icon map and the dashed "no results" boxes are gone
// — status comes from the shared `StatusDot` / `STATUS_ICON` vocabulary, empty
// panes are `EmptyState`s with a required action, and every schema line carries
// a `DiffGutter` because DESIGN-SYSTEM §1.5 measures the green/red pair at
// ΔE 5.6 under deuteranopia in dark mode.
import type { ReactNode } from 'react'
import { FilePen, Minus, Plus } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { DiffGutter, type DiffKind } from '@renderer/components/ui/diff-gutter'
import { EmptyState, type EmptyStateVariant } from '@renderer/components/ui/empty-state'
import { STATUS_ICON, statusTone } from '@renderer/components/ui/status-dot'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import type { ComparePhase } from './diff-panel-formatters'

/** The compare phase mapped onto the shared job state machine (DS §7). */
export function comparePhaseStatus(phase: ComparePhase): 'idle' | 'running' | 'done' | 'cancelled' {
  if (phase === 'loading-tables' || phase === 'comparing') return 'running'
  if (phase === 'done') return 'done'
  if (phase === 'cancelled') return 'cancelled'
  return 'idle'
}

const TONE_INK = {
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
  running: 'text-running-text',
  idle: 'text-fg-muted'
} as const

export function ComparePhaseIcon({ phase }: { phase: ComparePhase }) {
  const status = comparePhaseStatus(phase)
  const Icon = STATUS_ICON[status]
  return (
    <Icon
      aria-hidden
      strokeWidth={1.75}
      className={cn(
        'size-3.5 shrink-0',
        status === 'running' && 'animate-spin-slow',
        TONE_INK[statusTone(status)]
      )}
    />
  )
}

/**
 * Presence/shape of a table diff. The glyph is the signal (DS §1.5); the tone
 * is reinforcement.
 */
export function KindBadge({ kind }: { kind: string }) {
  const { t } = useI18n()
  if (kind === 'only-in-source') {
    return (
      <Badge tone="accent" icon={Plus}>
        {t('diff.presentation.onlyInSource')}
      </Badge>
    )
  }
  if (kind === 'only-in-target') {
    return (
      <Badge tone="warning" icon={Minus}>
        {t('diff.presentation.onlyInTarget')}
      </Badge>
    )
  }
  return (
    <Badge tone="danger" icon={FilePen}>
      {t('diff.presentation.modified')}
    </Badge>
  )
}

/**
 * Which gutter sign a schema line gets, from the side it is rendered on:
 * present only on the source reads as an addition, only on the target as a
 * removal, and a changed definition as a modification.
 */
export function schemaLineDiffKind(kind: string, side: 'source' | 'target'): DiffKind {
  if (kind === 'only-in-source') return side === 'source' ? 'add' : 'same'
  if (kind === 'only-in-target') return side === 'target' ? 'del' : 'same'
  if (kind === 'modified' || kind === 'changed') return 'mod'
  return 'same'
}

export function EmptyResultState({
  title,
  description,
  action,
  variant = 'no-results',
  size = 'sm'
}: {
  title: string
  description: string
  /** DS §7.6 — an empty state without a way out is a dead end. */
  action: ReactNode
  variant?: EmptyStateVariant
  size?: 'sm' | 'md'
}) {
  return (
    <EmptyState
      variant={variant}
      size={size}
      title={title}
      description={description}
      action={action}
    />
  )
}

export function TableOpenActions({
  compareAvailable,
  sourceAvailable,
  targetAvailable,
  onOpenCompare,
  onOpenSource,
  onOpenTarget,
  className
}: {
  compareAvailable?: boolean
  sourceAvailable: boolean
  targetAvailable: boolean
  onOpenCompare?: () => void
  onOpenSource: () => void
  onOpenTarget: () => void
  className?: string
}) {
  const { t } = useI18n()
  return (
    <div className={className ?? 'flex flex-wrap items-center gap-1'}>
      {compareAvailable && onOpenCompare && (
        <Button size="sm" variant="secondary" onClick={onOpenCompare}>
          {t('diff.presentation.openCompare')}
        </Button>
      )}
      {sourceAvailable && (
        <Button size="sm" variant="ghost" onClick={onOpenSource}>
          {t('diff.presentation.openSource')}
        </Button>
      )}
      {targetAvailable && (
        <Button size="sm" variant="ghost" onClick={onOpenTarget}>
          {t('diff.presentation.openTarget')}
        </Button>
      )}
    </div>
  )
}

export interface DiffLine {
  text: string | null
  kind: DiffKind
}

const LINE_WASH: Record<DiffKind, string> = {
  add: 'bg-diff-add-bg',
  del: 'bg-diff-del-bg',
  mod: 'bg-diff-mod-bg',
  moved: 'bg-inset',
  same: 'bg-inset'
}

export function DiffColumn({ title, items }: { title: string; items: DiffLine[] }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-fg-muted">{title}</div>
      <ul className="min-w-0 space-y-0.5 font-mono text-xs">
        {items.map((item, index) =>
          item.text ? (
            <li
              key={index}
              data-diff={item.kind}
              className={cn(
                'flex min-w-0 items-start gap-2 rounded-sm px-2 py-1',
                LINE_WASH[item.kind]
              )}
            >
              <DiffGutter kind={item.kind} />
              <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{item.text}</span>
            </li>
          ) : (
            <li
              key={index}
              className="flex items-center gap-2 rounded-sm bg-inset px-2 py-1 text-fg-subtle"
            >
              <DiffGutter kind="same" />
              <span aria-hidden>—</span>
            </li>
          )
        )}
      </ul>
    </div>
  )
}
