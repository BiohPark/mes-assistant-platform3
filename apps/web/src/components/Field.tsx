import { cloneElement, useId, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Label } from './ui/label'

type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false' }
export interface FieldProps {
  label: ReactNode
  help?: ReactNode
  error?: ReactNode
  children: ReactElement<ControlProps>
  className?: string
}

export function Field({ label, help, error, children, className }: FieldProps) {
  const generatedId = useId()
  const id = children.props.id ?? generatedId
  const hasError = !!error
  const description = [children.props['aria-describedby'], help ? `${id}-help` : undefined, hasError ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined
  return (
    <div data-slot="field" className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, { id, 'aria-describedby': description, 'aria-invalid': hasError || children.props['aria-invalid'] })}
      {help && <p id={`${id}-help`} className="text-[13px] leading-5 text-muted-foreground">{help}</p>}
      {hasError && <p id={`${id}-error`} role="alert" className="text-[13px] leading-5 text-destructive">{error}</p>}
    </div>
  )
}
