import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { Chip } from './Chip'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'

export interface Option {
  value: string
  label: string
  hint?: string
  avatar?: ReactNode
  group?: string
}
export type SuggestSource = (query: string) => Option[] | Promise<Option[]>
interface CommonProps {
  source: SuggestSource
  allowCreate?: boolean
  quickPicks?: Option[]
  placeholder?: string
  invalidMessage?: string
  disabled?: boolean
  id?: string
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}
export type SuggestInputProps = CommonProps & (
  | { mode: 'single'; value: Option | null; onChange: (value: Option | null) => void }
  | { mode: 'multi'; value: Option[]; onChange: (value: Option[]) => void }
)

const normalize = (value: string) => value.trim().normalize('NFC')
const key = (value: string) => normalize(value).toLowerCase()
type Results = { query: string; status: 'pending' | 'ready' | 'error'; options: Option[] }

export function SuggestInput(props: SuggestInputProps) {
  const t = useT()
  const { source, allowCreate = false, quickPicks = [], disabled, className } = props
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [invalid, setInvalid] = useState(false)
  const [results, setResults] = useState<Results>({ query: '', status: 'pending', options: [] })
  const [showLoading, setShowLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const listId = useId()
  const errorId = `${listId}-error`
  const selected = props.mode === 'multi' ? props.value : props.value ? [props.value] : []
  const typed = normalize(text)
  const query = key(text)
  const ready = results.query === typed && results.status === 'ready'
  const failed = results.query === typed && results.status === 'error'
  const pending = !ready && !failed

  useEffect(() => {
    if (!open || disabled) return
    let cancelled = false
    setResults({ query: typed, status: 'pending', options: [] })
    function success(options: Option[]) {
      if (!cancelled) setResults({ query: typed, status: 'ready', options })
    }
    function failure() {
      if (!cancelled) setResults({ query: typed, status: 'error', options: [] })
    }
    try {
      const response = source(typed)
      if (Array.isArray(response)) success(response)
      else void response.then(success, failure)
    } catch {
      failure()
    }
    return () => { cancelled = true }
  }, [source, typed, open, disabled])

  useEffect(() => {
    setShowLoading(false)
    if (!open || !pending) return
    const timer = setTimeout(() => setShowLoading(true), 300)
    return () => clearTimeout(timer)
  }, [open, pending, typed])

  const seen = new Set<string>()
  const candidates = ready ? results.options.filter(option => {
    const optionKey = key(option.value)
    if (seen.has(optionKey) || (props.mode === 'multi' && selected.some(value => key(value.value) === optionKey))) return false
    seen.add(optionKey)
    return key(option.label).includes(query)
  }).sort((a, b) => Number(key(b.label).startsWith(query)) - Number(key(a.label).startsWith(query))) : []
  const canCreate = ready && allowCreate && !!typed && !results.options.some(option => key(option.label) === query || key(option.value) === query) && !selected.some(option => key(option.value) === query || key(option.label) === query)
  const options = [...candidates.map(option => ({ option, create: false })), ...(canCreate ? [{ option: { value: typed, label: typed }, create: true }] : [])]
  const activeIndex = Math.min(active, Math.max(0, options.length - 1))
  const picks = quickPicks.filter((option, i, all) => !selected.some(value => key(value.value) === key(option.value)) && all.findIndex(value => key(value.value) === key(option.value)) === i).slice(0, 6)
  const error = failed ? t('components.suggestFailed') : invalid ? props.invalidMessage ?? t('components.invalidValue') : undefined

  useEffect(() => {
    if (open && options.length) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex, listId, options.length])

  function commit(option: Option) {
    if (disabled) return
    if (props.mode === 'multi') {
      if (!props.value.some(value => key(value.value) === key(option.value))) props.onChange([...props.value, option])
    } else props.onChange(option)
    setText('')
    setInvalid(false)
    setActive(0)
    inputRef.current?.focus()
    setOpen(false)
  }
  function remove(option: Option) {
    if (props.mode === 'multi') props.onChange(props.value.filter(value => value.value !== option.value))
    else props.onChange(null)
    setInvalid(false)
    inputRef.current?.focus()
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActive(index => !open ? event.key === 'ArrowUp' ? Math.max(0, options.length - 1) : 0 : options.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : 0)
    } else if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation() }
      setOpen(false)
    } else if (event.key === 'Backspace' && !text && props.mode === 'multi' && selected.length) {
      event.preventDefault()
      remove(selected[selected.length - 1])
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      if (event.key === 'Enter') event.preventDefault()
      if (open && ready && (typed || event.key === 'Enter')) {
        const option = options[activeIndex]?.option
        if (option) commit(option)
        else if (typed) setInvalid(true)
      }
      if (event.key === 'Tab') setOpen(false)
    }
  }

  return (
    <div className={cn('min-w-0', className)}>
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className={cn('flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-input bg-card px-2 py-1 focus-within:border-ring', (error || props['aria-invalid'] === true || props['aria-invalid'] === 'true') && 'border-destructive', disabled && 'opacity-50')}>
            {selected.map(option => <Chip key={option.value} label={option.label} disabled={disabled} onRemove={() => remove(option)} onClick={props.mode === 'single' ? () => { setText(option.label); setActive(0); setInvalid(false); inputRef.current?.focus(); setOpen(true) } : undefined} actionLabel={props.mode === 'single' ? t('components.editValue', { value: option.label }) : undefined}>
              {option.avatar}<span className="truncate">{option.label}</span>
            </Chip>)}
            <input
              ref={inputRef}
              id={props.id}
              value={text}
              disabled={disabled}
              role="combobox"
              aria-autocomplete="list"
              aria-label={props['aria-label'] ?? t('components.suggestLabel')}
              aria-expanded={open && !disabled}
              aria-controls={open && !disabled ? listId : undefined}
              aria-activedescendant={open && !disabled && options.length ? `${listId}-${activeIndex}` : undefined}
              aria-invalid={!!error || props['aria-invalid']}
              aria-describedby={[props['aria-describedby'], error ? errorId : undefined].filter(Boolean).join(' ') || undefined}
              placeholder={props.placeholder ?? t('components.suggestPlaceholder')}
              onChange={event => { setText(event.target.value); setOpen(true); setActive(0); setInvalid(false) }}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={onKeyDown}
              onCompositionStart={() => { composing.current = true }}
              onCompositionEnd={() => { composing.current = false }}
              className="h-6 min-w-16 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          role="presentation"
          align="start"
          collisionPadding={8}
          className="w-[var(--radix-popover-trigger-width)] min-w-48 p-1"
          onOpenAutoFocus={event => event.preventDefault()}
          onCloseAutoFocus={event => event.preventDefault()}
          onInteractOutside={event => { if (inputRef.current?.contains(event.target as Node)) event.preventDefault() }}
          onEscapeKeyDown={event => { event.preventDefault(); setOpen(false) }}
          style={{ pointerEvents: 'auto' }}
        >
          <ul id={listId} role="listbox" aria-label={props['aria-label'] ?? t('components.suggestLabel')} aria-busy={pending} className="max-h-[min(16rem,calc(var(--radix-popover-content-available-height)-0.5rem))] overflow-y-auto overscroll-contain">
            {options.map(({ option, create }, i) => <li key={option.value} id={`${listId}-${i}`} role="option" aria-selected={i === activeIndex} onMouseEnter={() => setActive(i)} onMouseDown={event => { event.preventDefault(); commit(option) }} className={cn('flex min-h-8 cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm', i === activeIndex && 'bg-accent text-accent-foreground')}>
              {option.avatar && <span className="shrink-0">{option.avatar}</span>}
              <span className="min-w-0 flex-1 truncate">{option.group && <span className="mr-1 text-xs text-muted-foreground">{option.group}</span>}<span>{create ? t('components.addNew', { value: option.label }) : option.label}</span></span>
              {option.hint && <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span>}
            </li>)}
          </ul>
          {showLoading && pending && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">{t('common.loading')}</p>}
          {ready && !options.length && <p className="px-2 py-1 text-xs text-muted-foreground">{t('components.noResults')}</p>}
        </PopoverContent>
      </Popover>
      {!!picks.length && <div className="mt-1.5 flex flex-wrap gap-1">{picks.map(option => <Chip key={option.value} label={option.label} variant="suggestion" disabled={disabled} onClick={() => commit(option)}>{option.avatar}<span>{option.label}</span>{option.hint && <span className="text-muted-foreground">{option.hint}</span>}</Chip>)}</div>}
      {error && <p id={errorId} role="alert" className="mt-1.5 text-[13px] leading-5 text-destructive">{error}</p>}
    </div>
  )
}
