import * as React from 'react'
import { cn } from '@renderer/lib/utils'

export type DiffKind = 'add' | 'del' | 'mod' | 'moved' | 'same'

export interface DiffGutterProps {
  kind: DiffKind
  leftNumber?: number
  rightNumber?: number
  className?: string
}

/** The glyph is the signal; the colour is reinforcement. */
export const DIFF_SIGN: Record<DiffKind, string> = {
  add: '+',
  del: '−',
  mod: '~',
  moved: '⇄',
  same: ' '
}

export const DIFF_INK: Record<DiffKind, string> = {
  add: 'text-diff-add',
  del: 'text-diff-del',
  mod: 'text-diff-mod',
  moved: 'text-diff-moved',
  same: 'text-fg-subtle'
}

export const DIFF_ROW_BG: Record<DiffKind, string> = {
  add: 'bg-diff-add-bg',
  del: 'bg-diff-del-bg',
  mod: 'bg-diff-mod-bg',
  moved: '',
  same: ''
}

/**
 * MANDATORY on every diff surface: the measured green/red separation under
 * deuteranopia is ΔE 5.6 in dark mode, below the ΔE 6 floor, so colour alone
 * does not distinguish added from removed.
 */
export function DiffGutter({ kind, leftNumber, rightNumber, className }: DiffGutterProps) {
  const showNumbers = leftNumber != null || rightNumber != null
  return (
    <span
      data-diff={kind}
      className={cn('inline-flex shrink-0 items-center gap-2 font-mono text-2xs', DIFF_INK[kind], className)}
    >
      {showNumbers ? (
        <>
          <span className="w-8 text-right text-fg-subtle">{leftNumber ?? ''}</span>
          <span className="w-8 text-right text-fg-subtle">{rightNumber ?? ''}</span>
        </>
      ) : null}
      <span aria-hidden className="w-[1ch] text-center">
        {DIFF_SIGN[kind]}
      </span>
    </span>
  )
}
