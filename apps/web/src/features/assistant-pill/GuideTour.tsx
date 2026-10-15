import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/app/useMediaQuery'
import { pageRoute } from './pageActions'
import { tourTarget, useTourStore } from './tour'
import { saveGuideOffer, TUTORIAL_REPLAY } from './tutorial'

const PAD = 4
const GAP = 12
const MARGIN = 8
const CARD_WIDTH = 320
const CARD_FALLBACK_HEIGHT = 160 // 첫 렌더·jsdom — 측정 전 자리 계산용

/**
 * 가이드 투어 오버레이 — 현재 단계의 `data-tour` 대상을 primary 테두리 + 바깥 딤(box-shadow)으로 강조하고 설명 카드를 붙인다.
 * 카드는 섹션 단위: 섹션 제목·전체 진행, 접이식 섹션 목록(현재 위치·완료 ✓·다시 보기), 이 섹션 건너뛰기. 완료는 사용자별 localStorage.
 * 비모달: 페이지는 그대로 조작된다. 카드 포커스에서 Enter·Space=다음, Esc=닫기(어디서든). 대상은 화면 안으로 스크롤하고 스크롤·리사이즈를 따라간다.
 * <768은 카드를 아래 여백에 고정(대상이 그 자리면 위로). 닫히면 포커스가 알약으로 돌아간다. AI를 호출하지 않는다
 */
export function GuideTour({ userId, pillRef }: { userId: string; pillRef: RefObject<HTMLButtonElement | null> }) {
  const t = useT()
  const { pathname } = useLocation()
  const route = useTourStore((state) => state.route)
  const sections = useTourStore((state) => state.sections)
  const sectionIndex = useTourStore((state) => state.sectionIndex)
  const stepIndex = useTourStore((state) => state.stepIndex)
  const done = useTourStore((state) => state.done)
  const section = route ? sections[sectionIndex] : undefined
  const step = section?.steps[stepIndex]
  const wide = useMediaQuery('(min-width: 768px)')
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const cardRef = useRef<HTMLDivElement>(null)
  const startedAt = useRef<string | null>(null)
  const listId = useId()
  const [listOpen, setListOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [height, setHeight] = useState(CARD_FALLBACK_HEIGHT) // 단계 본문·목록 펼침이 바뀔 때마다 실제 높이로 — 하단 clamp가 어긋나지 않게
  const close = () => { useTourStore.getState().close(); pillRef.current?.focus() }
  /** 마지막 단계·마지막 섹션을 지나 투어가 끝나면 포커스를 알약으로 돌린다 */
  const run = (action: () => void) => { action(); if (!useTourStore.getState().route) pillRef.current?.focus() }
  const next = () => run(() => useTourStore.getState().next())

  // 내 정보 '튜토리얼 다시 보기' → 현재 페이지 투어(제안은 수락으로 기록)
  useEffect(() => {
    const replay = () => {
      const current = pageRoute(pathname)
      saveGuideOffer(userId, current, 'accepted')
      useTourStore.getState().start(current, userId)
    }
    window.addEventListener(TUTORIAL_REPLAY, replay)
    return () => window.removeEventListener(TUTORIAL_REPLAY, replay)
  }, [pathname, userId])

  // 페이지를 떠나면 닫는다 — 대상이 바뀐다
  useEffect(() => {
    if (!route) { startedAt.current = null; setListOpen(false); return }
    startedAt.current ??= pathname
    if (startedAt.current !== pathname) useTourStore.getState().close()
  }, [route, pathname])

  useEffect(() => {
    if (!route) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close() } }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [route]) // close는 ref·스토어만 읽는다 — 최신 클로저가 필요 없다

  useLayoutEffect(() => {
    if (!step) { setRect(null); return }
    const target = tourTarget(step.target)
    target?.scrollIntoView({ block: wide ? 'center' : 'start', behavior: reduced ? 'auto' : 'smooth' })
    setRect(target?.getBoundingClientRect() ?? null)
    let frame = 0
    const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setRect(tourTarget(step.target)?.getBoundingClientRect() ?? null)) }
    window.addEventListener('resize', measure)
    document.addEventListener('scroll', measure, true) // 스크롤 컨테이너·부드러운 스크롤 중에도 따라간다
    setHeight(cardRef.current?.offsetHeight || CARD_FALLBACK_HEIGHT)
    cardRef.current?.focus({ preventScroll: true })
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', measure); document.removeEventListener('scroll', measure, true) }
  }, [step, wide, reduced])
  useLayoutEffect(() => { if (step) setHeight(cardRef.current?.offsetHeight || CARD_FALLBACK_HEIGHT) }, [step, listOpen])

  if (!step || !section) return null
  const total = sections.reduce((count, item) => count + item.steps.length, 0)
  const current = sections.slice(0, sectionIndex).reduce((count, item) => count + item.steps.length, 0) + stepIndex + 1
  const last = current >= total
  let card: CSSProperties
  if (!wide) {
    const overlapsBottom = rect !== null && rect.bottom > window.innerHeight - MARGIN - height
    card = overlapsBottom ? { left: MARGIN, right: MARGIN, top: MARGIN } : { left: MARGIN, right: MARGIN, bottom: MARGIN }
  } else if (!rect) {
    card = { left: MARGIN, bottom: MARGIN, width: CARD_WIDTH }
  } else {
    const below = rect.bottom + GAP
    const wanted = below + height <= window.innerHeight - MARGIN ? below : rect.top - GAP - height
    const top = Math.min(Math.max(wanted, MARGIN), Math.max(MARGIN, window.innerHeight - height - MARGIN)) // 위도 모자라거나 대상이 아직 화면 밖이면 화면 안으로
    const left = Math.min(Math.max(rect.left, MARGIN), Math.max(MARGIN, window.innerWidth - CARD_WIDTH - MARGIN))
    card = { left, top, width: CARD_WIDTH }
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return // 카드 안 버튼의 Enter·Space는 그 버튼 몫
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); next() }
  }

  return <>
    {rect && <div data-testid="tour-spotlight" aria-hidden="true" style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
      className="pointer-events-none fixed z-50 rounded-lg border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] transition-all duration-200 motion-reduce:transition-none" />}
    <div ref={cardRef} role="dialog" aria-label={t('tour.title')} tabIndex={-1} style={card} onKeyDown={onKeyDown}
      className="fixed z-50 max-w-[calc(100vw-16px)] space-y-2 rounded-2xl border bg-popover p-3 text-sm text-popover-foreground shadow-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 truncate text-xs font-semibold">{t(section.title)}</h2>
        <span className="shrink-0 text-xs text-muted-foreground">{t('tour.progress', { current, total })}</span>
        <Button variant="ghost" size="icon-xs" className="ml-auto shrink-0" aria-label={t('tour.close')} onClick={close}><X /></Button>
      </div>
      <p aria-live="polite" className="leading-snug">{t(step.text)}</p>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <button type="button" aria-expanded={listOpen} aria-controls={listId} onClick={() => setListOpen((open) => !open)}
          className="flex items-center gap-1 rounded-lg px-1 py-0.5 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <ChevronDown aria-hidden className={cn('size-3.5 transition-transform motion-reduce:transition-none', !listOpen && '-rotate-90')} />{t('tour.sectionList')}
        </button>
        <span className="ml-auto">{t('tour.sectionPosition', { current: sectionIndex + 1, total: sections.length })}</span>
      </div>
      {listOpen && <ol id={listId} aria-label={t('tour.sectionListLabel')} className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
        {sections.map((item, index) => {
          const isCurrent = index === sectionIndex
          const isDone = done.includes(item.id)
          return <li key={item.id}>
            <button type="button" aria-current={isCurrent ? 'step' : undefined} aria-label={isDone ? t('tour.doneReplay', { title: t(item.title) }) : undefined}
              onClick={() => { useTourStore.getState().goToSection(index) }}
              className={cn('flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', isCurrent && 'bg-muted font-medium')}>
              <span className="flex-1 truncate">{t(item.title)}</span>
              {isDone && <Check aria-hidden className="size-3.5 shrink-0 text-primary" />}
            </button>
          </li>
        })}
      </ol>}
      <div className="flex items-center justify-end gap-2">
        <Button size="xs" variant="ghost" disabled={current === 1} onClick={() => useTourStore.getState().prev()}>{t('tour.prev')}</Button>
        <Button size="xs" variant="ghost" onClick={() => run(() => useTourStore.getState().skipSection())}>{t('tour.skipSection')}</Button>
        <Button size="xs" onClick={next}>{t(last ? 'tour.finish' : 'tour.next')}</Button>
      </div>
    </div>
  </>
}
