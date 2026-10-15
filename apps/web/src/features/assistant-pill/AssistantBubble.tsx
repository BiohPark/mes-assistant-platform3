import { useEffect, useRef, useState, type RefObject } from 'react'
import { X } from 'lucide-react'
import { useT } from '@/i18n'
import type { PillPos } from '@/app/uiStore'
import { RequestInfoDialog } from '@/features/chat/RequestInfoDialog'
import { BUBBLE_TTL_MS, useBubbleStore, type Bubble, type BubbleSource } from './bubbles'
import { usePillAnchor } from './pillAnchor'

const WIDTH = 260
const MESSAGE = { 'budget.warn': 'bubble.budgetWarn', 'budget.over': 'bubble.budgetOver', 'request.slow': 'bubble.requestSlow' } as const satisfies Record<BubbleSource, string>

/** 알약 옆 말풍선(U6) — 큐 1개, 8초 뒤 소멸(hover·focus 중 정지), 클릭하면 트레이(onOpen)나 요청 정보를 연다. 서버 알림(벨)과 겹치지 않고 AI를 호출하지 않는다 */
export function AssistantBubble({ pillRef, pos }: { pillRef: RefObject<HTMLButtonElement | null>; pos: PillPos | null }) {
  const t = useT()
  const current = useBubbleStore((state) => state.current)
  const dismiss = useBubbleStore((state) => state.dismiss)
  const [infoId, setInfoId] = useState<string | null>(null)
  const place = usePillAnchor(current !== null, pillRef, pos, WIDTH)
  const paused = useRef(0) // hover + focus 겹침 수
  const deadline = useRef(0)
  const remaining = useRef(0) // 정지 시점의 남은 시간 — 재개 때 이어서 센다
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!current) return
    paused.current = 0
    deadline.current = Date.now() + BUBBLE_TTL_MS
    timer.current = setTimeout(dismiss, BUBBLE_TTL_MS)
    return () => clearTimeout(timer.current)
  }, [current, dismiss])
  const pause = () => { if (paused.current++ === 0) { clearTimeout(timer.current); remaining.current = Math.max(0, deadline.current - Date.now()) } }
  const resume = () => { if (--paused.current === 0) { deadline.current = Date.now() + remaining.current; timer.current = setTimeout(dismiss, remaining.current) } }
  const open = (bubble: Bubble) => {
    if (bubble.onOpen) bubble.onOpen()
    else if (bubble.requestId) setInfoId(bubble.requestId)
    dismiss()
  }

  return <>
    <div role="status" aria-live="polite" aria-label={t('bubble.region')} style={current ? { left: place.left, bottom: place.bottom, width: WIDTH } : undefined}
      className={current ? 'fixed z-40 max-w-[calc(100vw-16px)]' : 'sr-only'}>
      {current && <div key={current.id} data-testid="assistant-bubble" onMouseEnter={pause} onMouseLeave={resume} onFocus={pause} onBlur={resume}
        className="flex items-start gap-1 rounded-2xl border bg-popover p-2 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-left-2 motion-reduce:animate-none">
        <button type="button" className="flex-1 text-left leading-snug hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-lg" onClick={() => open(current)}>{t(MESSAGE[current.source])}</button>
        <button type="button" aria-label={t('bubble.close')} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={dismiss}><X className="size-3.5" /></button>
      </div>}
    </div>
    {infoId && <RequestInfoDialog requestId={infoId} onClose={() => setInfoId(null)} />}
  </>
}
