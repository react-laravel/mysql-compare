import * as React from 'react'
import { Search, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { IconButton } from './icon-button'
import { Input, type InputProps } from './input'

export interface SearchInputProps
  extends Omit<InputProps, 'leading' | 'trailing' | 'value' | 'onChange'> {
  value: string
  onValueChange: (value: string) => void
  /** 0 = report every keystroke */
  debounceMs?: number
  /** shows the clear button; Esc clears, a second Esc blurs */
  clearable?: boolean
  clearLabel?: string
  /**
   * Overrides what clearing means. The WHERE field needs it: emptying the box
   * is not the same as dropping the applied filter and re-querying.
   */
  onClear?: () => void
  /** swap the leading glyph — the WHERE field uses `Filter` */
  leadingIcon?: LucideIcon
}

/**
 * `Input` preset: search glyph, clear affordance, Esc-to-clear, optional
 * debounce. Replaces the five hand-rolled icon+input+clear-× copies.
 */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      value,
      onValueChange,
      debounceMs = 0,
      clearable = true,
      clearLabel = 'Clear',
      onClear,
      leadingIcon = Search,
      size = 'md',
      className,
      containerClassName,
      onKeyDown,
      ...rest
    },
    ref
  ) {
    const [draft, setDraft] = React.useState(value)
    const inner = React.useRef<HTMLInputElement | null>(null)
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const report = React.useRef(onValueChange)
    report.current = onValueChange

    // The controlled value wins whenever it changes underneath us (reset, or a
    // programmatic filter change from a menu item).
    React.useEffect(() => {
      setDraft(value)
    }, [value])

    React.useEffect(() => () => {
      if (timer.current) clearTimeout(timer.current)
    }, [])

    const push = (next: string) => {
      setDraft(next)
      if (debounceMs === 0) {
        report.current(next)
        return
      }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => report.current(next), debounceMs)
    }

    const clear = () => {
      if (timer.current) clearTimeout(timer.current)
      setDraft('')
      if (onClear) onClear()
      else report.current('')
    }

    const setRefs = (node: HTMLInputElement | null) => {
      inner.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    }

    return (
      <Input
        ref={setRefs}
        type="search"
        size={size}
        leading={leadingIcon}
        containerClassName={containerClassName}
        className={cn('[&::-webkit-search-cancel-button]:hidden', className)}
        value={draft}
        onChange={(event) => push(event.target.value)}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented) return
          if (event.key !== 'Escape') return
          event.preventDefault()
          if (draft) {
            // The press was consumed here; it must not also close the dialog or
            // popover this field happens to sit inside.
            event.stopPropagation()
            clear()
          } else {
            inner.current?.blur()
          }
        }}
        trailing={
          clearable && draft ? (
            <IconButton
              icon={X}
              label={clearLabel}
              size="xs"
              variant="ghost"
              tooltip={false}
              title={clearLabel}
              tabIndex={-1}
              onClick={() => {
                clear()
                inner.current?.focus()
              }}
            />
          ) : undefined
        }
        {...rest}
      />
    )
  }
)
