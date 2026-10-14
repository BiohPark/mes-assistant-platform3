import { cloneElement, useId, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { SaveState } from '@/lib/useAutoSave'
import { Label } from './ui/label'
import { SaveStatus } from './SaveStatus'

type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false' }
export interface FieldProps {
  label: ReactNode
  help?: ReactNode
  error?: ReactNode
  /** 자동 저장 상태 — 저장됨·오류를 이 필드 아래에 보이고 설명으로 연결한다 */
  status?: SaveState
  children: ReactElement<ControlProps>
  className?: string
}

export function Field({ label, help, error, status, children, className }: FieldProps) {
  const generatedId = useId()
  const id = children.props.id ?? generatedId
  const hasError = !!error || status?.status === 'error'
  const description = [children.props['aria-describedby'], help ? `${id}-help` : undefined, error ? `${id}-error` : undefined, status ? `${id}-status` : undefined].filter(Boolean).join(' ') || undefined
  return (
    <div data-slot="field" className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, { id, 'aria-describedby': description, 'aria-invalid': hasError || children.props['aria-invalid'] })}
      {help && <p id={`${id}-help`} className="text-[13px] leading-5 text-muted-foreground">{help}</p>}
      {!!error && <p id={`${id}-error`} role="alert" className="text-[13px] leading-5 text-destructive">{error}</p>}
      <SaveStatus id={`${id}-status`} state={status} />
    </div>
  )
}
