import { useRef } from 'react'
import { useT } from '@/i18n'

/** Lives in the existing message action row; selection only edits the draft. */
export function AnswerChoices({ items, onChoose }: { items: string[]; onChoose: (text: string) => void }) {
  const t = useT()
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  return <div role="group" aria-label={t('chat.answerChoices')} className="flex min-w-0 flex-wrap gap-1" onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    const index = buttons.current.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      buttons.current[(index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]?.focus()
    } else if (/^[1-6]$/.test(event.key)) {
      const item = items[Number(event.key) - 1]
      if (item !== undefined) { event.preventDefault(); onChoose(item) }
    }
  }}>
    {items.map((text, index) => <button key={index} ref={element => { buttons.current[index] = element }} type="button"
      className="min-h-11 max-w-full rounded-full border bg-card px-3 py-2 text-left text-xs break-words hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onChoose(text)}>{index + 1}. {text}</button>)}
  </div>
}
