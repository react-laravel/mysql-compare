import * as React from 'react'
import { cn } from '@renderer/lib/utils'

export interface KbdProps {
  /** `Mod` renders ⌘ on mac and Ctrl elsewhere; `+`-separated chords are split */
  children: string
  className?: string
}

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
}

const NAMED: Record<string, string> = {
  mod: '⌘',
  cmd: '⌘',
  meta: '⌘',
  shift: '⇧',
  alt: '⌥',
  option: '⌥',
  ctrl: '⌃',
  control: '⌃',
  enter: '↵',
  esc: 'Esc',
  escape: 'Esc',
  tab: '⇥',
  space: 'Space',
  backspace: '⌫',
  delete: '⌦',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→'
}

export function formatChord(chord: string, mac = isMac()): string {
  return chord
    .split('+')
    .map((part) => {
      const key = part.trim().toLowerCase()
      if (key === 'mod') return mac ? '⌘' : 'Ctrl'
      if (key === 'alt' || key === 'option') return mac ? '⌥' : 'Alt'
      if (key === 'ctrl' || key === 'control') return mac ? '⌃' : 'Ctrl'
      return NAMED[key] ?? part.trim().toUpperCase()
    })
    .join(mac ? '' : '+')
}

/** A key or chord. Mono, `text-2xs`. */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-xs border border-border',
        'bg-surface-2 px-1 font-mono text-2xs font-medium text-fg-muted',
        className
      )}
    >
      {formatChord(children)}
    </kbd>
  )
}
