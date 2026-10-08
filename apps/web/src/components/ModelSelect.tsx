import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useModelList } from '@/lib/useModelList'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'

export interface ModelSelectProps {
  value: string
  onChange: (value: string) => void
  id?: string
  disabled?: boolean
  className?: string
  placeholder?: string
  'aria-label'?: string
}

/** 모델 ID 콤보박스 — 서버 목록에서 고르거나 직접 입력한다. 목록 로딩·실패·빈 상태를 알리고 실패 시에도 입력은 그대로 쓴다. */
export function ModelSelect({ value, onChange, id, disabled, className, placeholder, ...props }: ModelSelectProps) {
  const t = useT()
  const { models, loading, error, reload } = useModelList()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  /** 입력 중에만 목록을 거른다 — 선택 뒤나 셰브론·포커스로 열면 전체 목록 */
  const [filtering, setFiltering] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  /** 프로그램으로 포커스를 줄 때는 onFocus가 목록을 다시 열지 않게 한다 */
  const silentFocus = useRef(false)
  const listId = useId()
  const label = props['aria-label'] ?? t('admin.test.modelSelect')
  const query = value.trim().toLowerCase()
  const options = filtering ? models.filter((model) => model.toLowerCase().includes(query)) : models
  const activeIndex = Math.min(active, Math.max(0, options.length - 1))
  const expanded = open && !disabled

  function focusInput() {
    if (document.activeElement === inputRef.current) return
    silentFocus.current = true
    inputRef.current?.focus()
    silentFocus.current = false
  }
  function commit(model: string) {
    onChange(model)
    setOpen(false)
    setFiltering(false)
    setActive(0)
    focusInput()
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActive((index) => !open ? (event.key === 'ArrowUp' ? Math.max(0, options.length - 1) : 0) : options.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : 0)
    } else if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation() }
      setOpen(false)
    } else if (event.key === 'Enter' && open && options.length) {
      event.preventDefault()
      commit(options[activeIndex]!)
    }
  }

  return (
    <div className={cn('min-w-0', className)}>
      <Popover open={expanded} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div ref={anchorRef} className={cn('flex h-8 items-center gap-1 rounded-lg border border-input bg-card pr-1 pl-2 focus-within:border-ring', disabled && 'opacity-50')}>
            <input
              ref={inputRef}
              id={id}
              value={value}
              disabled={disabled}
              role="combobox"
              aria-autocomplete="list"
              aria-label={label}
              aria-expanded={expanded}
              aria-controls={expanded ? listId : undefined}
              aria-activedescendant={expanded && options.length ? `${listId}-${activeIndex}` : undefined}
              placeholder={placeholder ?? t('admin.test.modelPlaceholder')}
              onChange={(event) => { onChange(event.target.value); setFiltering(true); setOpen(true); setActive(0) }}
              onFocus={() => { if (!silentFocus.current) { setFiltering(false); setOpen(true) } }}
              onBlur={() => setOpen(false)}
              onKeyDown={onKeyDown}
              className="h-6 min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
            <button type="button" disabled={disabled} aria-label={t('admin.test.modelOpenList')} aria-expanded={expanded} onMouseDown={(event) => { event.preventDefault(); setFiltering(false); setOpen(!open); focusInput() }} className="rounded-md p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronDown aria-hidden className="size-4" />
            </button>
          </div>
        </PopoverAnchor>
        <PopoverContent
          role="presentation"
          align="start"
          collisionPadding={8}
          className="w-[var(--radix-popover-trigger-width)] min-w-48 p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => { if (anchorRef.current?.contains(event.target as Node)) event.preventDefault() }}
          onEscapeKeyDown={(event) => { event.preventDefault(); setOpen(false) }}
          style={{ pointerEvents: 'auto' }}
        >
          {loading && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">{t('admin.test.modelLoading')}</p>}
          {!loading && error && <div role="alert" className="flex flex-wrap items-center gap-2 px-2 py-1 text-xs text-destructive">
            <span>{t('admin.test.modelLoadFailed')}</span>
            <button type="button" className="rounded-md border px-1.5 py-0.5 text-foreground hover:bg-muted" onMouseDown={(event) => { event.preventDefault(); void reload() }}>{t('admin.test.modelRetry')}</button>
          </div>}
          {!loading && !error && models.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">{t('admin.test.modelEmpty')}</p>}
          {!loading && !error && models.length > 0 && options.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">{t('admin.test.modelNoMatch')}</p>}
          <ul id={listId} role="listbox" aria-label={label} aria-busy={loading} className="max-h-[min(16rem,calc(var(--radix-popover-content-available-height)-0.5rem))] overflow-y-auto overscroll-contain">
            {options.map((model, index) => <li key={model} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActive(index)} onMouseDown={(event) => { event.preventDefault(); commit(model) }} className={cn('flex min-h-8 cursor-pointer items-center gap-2 rounded-lg px-2 py-1 font-mono text-sm', index === activeIndex && 'bg-accent text-accent-foreground')}>
              {value === model ? <Check aria-hidden className="size-3 shrink-0" /> : <span className="size-3 shrink-0" />}
              <span className="truncate">{model}</span>
            </li>)}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  )
}
