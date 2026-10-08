import { useT } from '@/i18n'
import { useId, useState, type KeyboardEvent } from 'react'
import { Plus } from 'lucide-react'
import { normalizeTag, tagKey, type TagSuggestion } from '@mes/domain'
import { cn } from '@/lib/utils'
import { TagChip } from './TagChip'

const MAX_SUGGESTIONS = 8

interface TagInputProps {
  tags: string[]
  onAdd: (tag: string) => void | Promise<unknown>
  onRemove: (tag: string) => void | Promise<unknown>
  /** 자동완성 후보 (빈도순). prefix는 정규화 전 입력값 */
  suggest: (prefix: string, exclude: string[]) => TagSuggestion[]
  onChipClick?: (tag: string) => void
  readOnly?: boolean
  placeholder?: string
  className?: string
}

/**
 * Obsidian frontmatter tags 같은 입력: 칩 + 인라인 입력.
 * Enter·쉼표·Tab으로 추가, Backspace(빈 입력)로 마지막 칩 삭제, ↑↓로 후보 이동.
 */
export function TagInput({ tags, onAdd, onRemove, suggest, onChipClick, readOnly, placeholder, className }: TagInputProps) {
  const translate = useT()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()

  const candidates = open ? suggest(text, tags).slice(0, MAX_SUGGESTIONS) : []
  const typed = normalizeTag(text)
  const typedIsNew = !!typed && !candidates.some((c) => tagKey(c.tag) === tagKey(typed)) && !tags.some((t) => tagKey(t) === tagKey(typed))
  const options = [...candidates.map((c) => ({ tag: c.tag, hint: c.isSr ? 'SR' : `${c.count}` })), ...(typedIsNew ? [{ tag: typed, hint: translate('components.newTag') }] : [])]
  const activeIndex = Math.min(active, Math.max(0, options.length - 1))

  function commit(tag: string) {
    const t = normalizeTag(tag)
    setText('')
    setActive(0)
    if (!t || tags.some((x) => tagKey(x) === tagKey(t))) return
    void onAdd(t)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (options.length ? (i + step + options.length) % options.length : 0))
      return
    }
    if (e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && text)) {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      // 후보를 고른 상태면 후보, 아니면 입력값 그대로
      const pick = options[activeIndex]?.tag ?? text
      commit(open && options.length ? pick : text)
      return
    }
    if (e.key === 'Backspace' && !text && tags.length) {
      void onRemove(tags[tags.length - 1])
      return
    }
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className={cn('relative flex min-w-0 flex-wrap items-center gap-1', className)}>
      {tags.map((t) => (
        <TagChip key={t} tag={t} onClick={onChipClick} onRemove={readOnly ? undefined : onRemove} />
      ))}
      {!readOnly && (
        <div className="relative">
          <Plus className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 text-muted-foreground" />
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setOpen(true)
              setActive(0)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? translate('components.addTag')}
            aria-label={translate('components.tagInput')}
            title={translate('components.tagInputHint')}
            role="combobox"
            aria-expanded={open && options.length > 0}
            aria-controls={listId}
            className="h-6 w-28 rounded-full border border-dashed bg-transparent pr-2 pl-5 text-xs outline-none placeholder:text-muted-foreground focus:w-40 focus:border-solid focus:border-ring"
          />
          {open && options.length > 0 && (
            <ul id={listId} role="listbox" className="absolute top-7 left-0 z-50 w-56 overflow-hidden rounded-lg border bg-popover p-1 shadow-md">
              {options.map((o, i) => (
                <li
                  key={o.tag}
                  role="option"
                  aria-selected={i === activeIndex}
                  // blur보다 먼저 선택되도록 mousedown에서 처리
                  onMouseDown={(e) => {
                    e.preventDefault()
                    commit(o.tag)
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn('flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-xs', i === activeIndex && 'bg-muted')}
                >
                  <TagChip tag={o.tag} size="xs" />
                  <span className="text-xs text-muted-foreground">{o.hint}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
