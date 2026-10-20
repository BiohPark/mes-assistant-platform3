import { useEffect, useRef, useState, type RefObject } from 'react'
import { X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { useT, type Translator } from '@/i18n'
import type { PillPos } from '@/app/uiStore'
import { RequestInfoDialog } from '@/features/chat/RequestInfoDialog'
import { BUBBLE_TTL_MS, isReplyBubble, useBubbleStore, type Bubble, type BubbleSource, type ReplySource } from './bubbles'
import { recordNotice } from './history'
import { usePillAnchor } from './pillAnchor'
import { useTourStore } from './tour'

const WIDTH = 260
const MESSAGE = { 'budget.warn': 'bubble.budgetWarn', 'budget.over': 'bubble.budgetOver', 'request.slow': 'bubble.requestSlow', 'share.in': 'bubble.shareIn', 'share.out': 'bubble.shareOut', 'share.none': 'bubble.shareNone', 'guide.done': 'bubble.guideDone' } as const satisfies Record<Exclude<BubbleSource, ReplySource>, string>
const REPLY = { 'reply.done': 'bubble.replyDone', 'reply.failed': 'bubble.replyFailed', 'reply.cancelled': 'bubble.replyCancelled' } as const satisfies Record<ReplySource, string>
/** 이 페이지 로드의 표시 — 말풍선 id는 로드마다 1부터라 알림 이력(sessionStorage)의 키에 붙인다 */
const LOAD = Math.random().toString(36).slice(2, 8)

/** 말풍선 문구 — 말풍선과 도우미 창 '알림 이력'이 같이 쓴다 */
export function bubbleText(t: Translator, bubble: Pick<Bubble, 'source' | 'title' | 'counts'>): string {
  if (bubble.source.startsWith('reply.')) return t(REPLY[bubble.source as ReplySource], { title: bubble.title ?? '' })
  return t(MESSAGE[bubble.source as keyof typeof MESSAGE] as 'bubble.shareIn', bubble.counts ?? { conversations: 0, files: 0 })
}

/**
 * 알약 옆 말풍선(U6) — 큐 1개, 8초 뒤 소멸(hover·focus 중 정지), 클릭하면 요청 크기 안내(onOpen)나 요청 정보를 연다. reply.*는 제목·답 첫 문장과 [바로 가기](그 대화로 이동). 서버 알림(벨)과 겹치지 않고 AI를 호출하지 않는다.
 * S14-HH: 가이드가 진행되는 동안에는 미뤄 두었다가(시간도 멈춤) 끝나면 보이고, 실제로 보인 말풍선은 도우미 창 '알림 이력'에 남긴다
 */
export function AssistantBubble({ pillRef, pos }: { pillRef: RefObject<HTMLButtonElement | null>; pos: PillPos | null }) {
  const t = useT()
  const navigate = useNavigate()
  const queued = useBubbleStore((state) => state.current)
  const touring = useTourStore((state) => state.route !== null)
  const current = touring ? null : queued
  const dismiss = useBubbleStore((state) => state.dismiss)
  const [infoId, setInfoId] = useState<string | null>(null)
  const place = usePillAnchor(current !== null, pillRef, pos, WIDTH)
  const paused = useRef(0) // hover + focus 겹침 수
  const deadline = useRef(0)
  const remaining = useRef(0) // 정지 시점의 남은 시간 — 재개 때 이어서 센다
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!current) return
    recordNotice({ key: `${LOAD}-${current.id}`, source: current.source, title: current.title, excerpt: current.excerpt, taskId: current.taskId, counts: current.counts })
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
  const go = (taskId: string) => { void navigate(`/c/${encodeURIComponent(taskId)}`); dismiss() }

  return <>
    <div role="status" aria-live="polite" aria-label={t('bubble.region')} style={current ? { left: place.left, bottom: place.bottom, width: WIDTH } : undefined}
      className={current ? 'fixed z-40 max-w-[calc(100vw-16px)]' : 'sr-only'}>
      {current && <div key={current.id} data-testid="assistant-bubble" onMouseEnter={pause} onMouseLeave={resume} onFocus={pause} onBlur={resume}
        className="flex items-start gap-1 rounded-2xl border bg-popover p-2 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-left-2 motion-reduce:animate-none">
        {isReplyBubble(current)
          ? <div className="flex-1 space-y-1.5 leading-snug">
            <p>{bubbleText(t, current)}</p>
            {current.excerpt && <p data-testid="bubble-excerpt" className="line-clamp-2 text-xs text-muted-foreground">{current.excerpt}</p>}
            <Button size="xs" onClick={() => go(current.taskId)}>{t('bubble.goToConversation')}</Button>
          </div>
          : current.source.startsWith('share.') ? <p className="flex-1 leading-snug">{bubbleText(t, current)}</p>
          : <button type="button" className="flex-1 text-left leading-snug hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-lg" onClick={() => open(current)}>{bubbleText(t, current)}</button>}
        <button type="button" aria-label={t('bubble.close')} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={dismiss}><X className="size-3.5" /></button>
      </div>}
    </div>
    {infoId && <RequestInfoDialog requestId={infoId} onClose={() => setInfoId(null)} />}
  </>
}
