import type { ReactNode } from 'react'

/**
 * A settings row whose control is not a labellable form element (a segmented
 * `RadioGroup`, a button pair). `Field` is for real controls — it wires
 * `htmlFor`, which would point at nothing here.
 */
export function SettingsRow({
  label,
  hint,
  children
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
      {hint ? <p className="text-xs text-fg-subtle">{hint}</p> : null}
    </div>
  )
}
