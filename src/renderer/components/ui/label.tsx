import * as React from 'react'
import { cn } from '@renderer/lib/utils'

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  function Label({ className, ...props }, ref) {
    return (
      <label
        ref={ref}
        className={cn('text-xs font-medium leading-none text-fg-muted', className)}
        {...props}
      />
    )
  }
)
