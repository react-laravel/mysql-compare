import * as React from 'react'

/**
 * Controlled/uncontrolled duality. When `value` is `undefined` the hook owns the
 * state; otherwise the caller does and the setter only reports.
 */
export function useControllable<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void
): [T, (next: T) => void] {
  const [uncontrolled, setUncontrolled] = React.useState<T>(defaultValue)
  const controlled = value !== undefined
  const current = controlled ? (value as T) : uncontrolled

  const report = React.useRef(onChange)
  report.current = onChange

  const set = React.useCallback(
    (next: T) => {
      if (!controlled) setUncontrolled(next)
      report.current?.(next)
    },
    [controlled]
  )

  return [current, set]
}
