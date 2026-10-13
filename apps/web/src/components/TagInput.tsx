import { useT } from '@/i18n'
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { isSrTag, normalizeTag, tagKey, type TagSuggestion } from '@mes/domain'
import { cn } from '@/lib/utils'
import { TagChip } from './TagChip'

const MAX_SUGGESTIONS = 8

interface TagInputProps {
  tags: string[]
  onAdd: (tag: string) => void | Promise<unknown>
  onRemove: (tag: string) => void | Promise<unknown>
  /** 자동완성 후보 (완전>앞부분>부분, 그 안에서 사용 수 — rankTagSuggestions). prefix는 정규화 전 입력값 */
  suggest: (prefix: string, exclude: string[]) => TagSuggestion[]
  /** SR 번호 태그에 접수된 SR이 있는지. false면 'SR 미접수'로 구분, undefined면 아직 모름 */
  srAccepted?: (tag: string) => boolean | undefined
  onChipClick?: (tag: string) => void
  readOnly?: boolean
  placeholder?: string
  className?: string
}

/**
 * Obsidian frontmatter tags 같은 입력: 칩 + 인라인 입력.
 * Enter·쉼표·Tab은 **입력값 그대로** 추가 — ↑↓·마우스로 후보를 명시적으로 고른 경우에만 그 후보를 추가한다
 * (CC-2099-001 입력에 사용 수 1위 CC-2099-0010이 붙는 오확정 방지). Backspace(빈 입력)로 마지막 칩 삭제.
 * 저장 실패 시 입력을 되살리고 토스트로 알린다. 저장 중에는 중복 제출하지 않는다.
 */
export function TagInput({ tags, onAdd, onRemove, suggest, srAccepted, onChipClick, readOnly, placeholder, className }: TagInputProps) {
  const translate = useT()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  /** ↑↓·마우스로 고른 후보 번호. null이면 고른 후보 없음 → 입력값 확정 */
  const [active, setActive] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const listId = useId()

  const candidates = open ? suggest(text, tags).slice(0, MAX_SUGGESTIONS) : []
  const typed = normalizeTag(text)
  const typedIsNew = !!typed && !candidates.some((c) => tagKey(c.tag) === tagKey(typed)) && !tags.some((t) => tagKey(t) === tagKey(typed))
  const srHint = (c: TagSuggestion) => `${translate(c.srAccepted ? 'components.srAccepted' : 'components.srUnaccepted')}${c.count ? ` · ${c.count}` : ''}`
  const options = [...candidates.map((c) => ({ tag: c.tag, hint: c.isSr ? srHint(c) : `${c.count}` })), ...(typedIsNew ? [{ tag: typed, hint: translate('components.newTag') }] : [])]
  const activeIndex = active === null || options.length === 0 ? null : Math.min(active, options.length - 1)

  async function commit(raw: string) {
    if (savingRef.current) return
    const t = normalizeTag(raw)
    setText('')
    setActive(null)
    if (!t || tags.some((x) => tagKey(x) === tagKey(t))) return
    savingRef.current = true
    setSaving(true)
    try {
      await onAdd(t)
    } catch (error) {
      // 저장 중 새로 친 글자가 있으면 그것을 지키고, 없으면 실패한 입력을 되살린다
      setText((current) => current || raw)
      toast.error(error instanceof Error && error.message ? error.message : translate('components.tagSaveFailed'))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      if (!options.length) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => ((i ?? (step > 0 ? -1 : 0)) + step + options.length) % options.length)
      return
    }
    if (e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && text)) {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      const picked = open && activeIndex !== null ? options[activeIndex]?.tag : undefined
      void commit(picked ?? text)
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
        <TagChip key={t} tag={t} onClick={onChipClick} onRemove={readOnly ? undefined : onRemove}
          note={srAccepted && isSrTag(t) && srAccepted(t) === false ? translate('components.srUnaccepted') : undefined} />
      ))}
      {!readOnly && (
        <div className="relative">
          <Plus className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 text-muted-foreground" />
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setOpen(true)
              setActive(null)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? translate('components.addTag')}
            aria-label={translate('components.tagInput')}
            aria-busy={saving}
            title={translate('components.tagInputHint')}
            role="combobox"
            aria-expanded={open && options.length > 0}
            aria-controls={listId}
            className="h-6 w-28 rounded-full border border-dashed bg-transparent pr-2 pl-5 text-xs outline-none placeholder:text-muted-foreground focus:w-40 focus:border-solid focus:border-ring"
          />
          {open && options.length > 0 && (
            <ul id={listId} role="listbox" onMouseLeave={() => setActive(null)} className="absolute top-7 left-0 z-50 w-56 overflow-hidden rounded-lg border bg-popover p-1 shadow-md">
              {options.map((o, i) => (
                <li
                  key={o.tag}
                  role="option"
                  aria-selected={i === activeIndex}
                  // blur보다 먼저 선택되도록 mousedown에서 처리
                  onMouseDown={(e) => {
                    e.preventDefault()
                    void commit(o.tag)
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
