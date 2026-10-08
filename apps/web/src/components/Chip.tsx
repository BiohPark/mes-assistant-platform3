import type { CSSProperties, ReactNode } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

export interface ChipProps {
  label: string
  children?: ReactNode
  variant?: 'value' | 'filter' | 'suggestion' | 'tag'
  size?: 'xs' | 'sm'
  selected?: boolean
  onClick?: () => void
  onRemove?: () => void
  disabled?: boolean
  className?: string
  style?: CSSProperties
  title?: string
  actionLabel?: string
  showAddIcon?: boolean
  removeLabel?: string
}

export function Chip({ label, children, variant = 'value', size = 'sm', selected, onClick, onRemove, disabled, className, style, title, actionLabel, removeLabel, showAddIcon = true }: ChipProps) {
  const t = useT()
  const body = <>{variant === 'filter' && selected && <Check aria-hidden className="size-3" />}{variant === 'suggestion' && showAddIcon && <Plus aria-hidden className="size-3 shrink-0" />}{children ?? <span className="truncate">{label}</span>}</>
  return (
    <span data-slot="chip" className={cn(
      'inline-flex max-w-full items-center gap-1 rounded-full border text-xs',
      variant === 'tag' ? 'bg-muted/40 text-foreground/80' : 'bg-card text-foreground',
      size === 'xs' ? 'h-5 px-1.5' : variant === 'filter' ? 'h-7 px-2' : 'h-6 px-2',
      variant === 'suggestion' && 'border-dashed',
      variant === 'filter' && 'border-muted-foreground/30 hover:border-foreground',
      selected && (variant === 'filter' ? 'bg-primary text-primary-foreground font-semibold' : 'border-primary/40 bg-accent'),
      variant !== 'tag' && !(variant === 'filter' && selected) && (onClick || onRemove) && !disabled && 'hover:bg-muted',
      disabled && 'opacity-50',
      className,
    )} style={style}>
      {onClick ? <button type="button" title={title} aria-label={actionLabel ?? label} aria-pressed={selected} disabled={disabled} onClick={onClick} className={cn('inline-flex min-w-0 items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring', variant === 'tag' ? 'hover:underline' : variant === 'filter' && selected ? '' : 'hover:bg-muted')}>{body}</button> : body}
      {onRemove && <button type="button" disabled={disabled} aria-label={removeLabel ?? t('components.removeValue', { value: label })} className="-mr-0.5 rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={onRemove}><X aria-hidden className="size-3" /></button>}
    </span>
  )
}
