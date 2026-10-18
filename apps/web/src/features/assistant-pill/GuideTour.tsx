import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/app/useMediaQuery'
import { useUiStore } from '@/app/uiStore'
import { useBubbleStore } from './bubbles'
import { say } from './history'
import { focusPageTarget, pageRoute } from './pageActions'
import { clampScroll, clearScroll, dockPlace, DOCK_WIDTH, nudgeTop, scrollPlan, tourTarget, useTourStore, type TourStep } from './tour'
import { saveGuideOffer, TUTORIAL_REPLAY } from './tutorial'

const PAD = 4
const CARD_FALLBACK_HEIGHT = 160 // 첫 렌더·jsdom — 측정 전 자리 계산용
const SETTLE_MS = 250 // 마지막 스크롤 이벤트 뒤 이만큼 조용하면 스크롤이 멈춘 것으로 본다

type Rect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height' | 'right' | 'bottom'>

/**
 * 가이드 코치(S14-HH) — 설명 말풍선·이전/다음·단계 표시는 도우미 창 자리(알약 바로 옆, 좁은 화면은 알약 위)에 고정하고, 대상은 제자리에서 딤 + 펄스 링으로 짚는다.
 * 손·눈이 알약 곁을 떠나지 않게: 말풍선은 대상을 따라 움직이지 않는다. 화면 밖 대상은 가운데로 부드럽게 스크롤하고, 멈춘 뒤에도 말풍선에 가리면 대상을 한 번 더 스크롤해 비킨다.
 * 스크롤로 비킬 수 없는 대상(fixed·sticky·스크롤 끝)만 말풍선이 같은 가로 자리에서 세로로 비킨다 — 화면 반대편으로 건너가지 않는다. 끝·그만은 도우미 창 대화 기록에 남는다.
 * 탭 전환은 대상이 닫힌 패널 안에 있을 때만 하고 말풍선에 알린다. 🧭 n/N · 이전/다음 · 다 봤어요 · ✕, 섹션 목록(현재·완료 ✓·다시 보기)·건너뛰기는 한 줄로 간결하게.
 * 비모달: 페이지는 그대로 조작된다. 말풍선 안에서 ←/→ = 이전/다음, 말풍선 자체 포커스에서 Enter·Space = 다음, Esc = 닫기(어디서든). 닫히면 포커스가 알약으로. AI를 호출하지 않는다
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
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const cardRef = useRef<HTMLDivElement>(null)
  const startedAt = useRef<string | null>(null)
  const listId = useId()
  const textId = useId()
  const [listOpen, setListOpen] = useState(false)
  /** 스포트라이트 — 스크롤 중에도 대상을 따라간다 */
  const [rect, setRect] = useState<Rect | null>(null)
  /** 비키기를 마친 대상 rect — 스크롤이 멈춘 뒤에만 바뀐다. 여전히 말풍선에 가리면 말풍선이 세로로 비킨다 */
  const [anchor, setAnchor] = useState<Rect | null>(null)
  const [height, setHeight] = useState(CARD_FALLBACK_HEIGHT)
  /** 이 단계에서 대상을 보이려고 바꾼 탭 — 말풍선에 알린다 */
  const [switched, setSwitched] = useState<NonNullable<TourStep['opens']> | null>(null)
  useUiStore((state) => state.pillPos) // 알약을 옮기면 말풍선도 따라간다
  const close = () => { useTourStore.getState().close(); say('helper', 'pill.log.guideStop'); pillRef.current?.focus() }
  /** 마지막 단계·마지막 섹션을 지나 투어가 끝나면 대화 기록에 남기고 포커스를 알약으로 돌린다 */
  const run = (action: () => void, ended: 'pill.log.guideDone' | 'pill.log.guideStop') => { action(); if (!useTourStore.getState().route) { say('helper', ended); pillRef.current?.focus() } }
  // next가 닫는 것은 마지막 단계를 지났을 때뿐 — 끝까지 봤으니 알약 옆에서 짧게 칭찬한다
  const next = () => run(() => { useTourStore.getState().next(); if (!useTourStore.getState().route) useBubbleStore.getState().push({ source: 'guide.done' }) }, 'pill.log.guideDone')
  /** 도우미 창 자리 — 렌더와 비키기 계산이 같이 쓴다 */
  const dock = (cardHeight: number) => dockPlace(pillRef.current?.getBoundingClientRect() ?? null, { width: DOCK_WIDTH, height: cardHeight }, { width: window.innerWidth, height: window.innerHeight })
  const prev = () => useTourStore.getState().prev()

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
    if (!route) { startedAt.current = null; setListOpen(false); setAnchor(null); return }
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
    setSwitched(null)
    setAnchor(null)
    if (!step) { setRect(null); return }
    let frame = 0
    let opening = 0
    let settle: ReturnType<typeof setTimeout> | undefined
    /** 이 단계에서 대상을 비키게 하는 스크롤은 한 번만 — fixed·sticky는 처음부터 시도하지 않는다 */
    let cleared = false
    const behavior = reduced ? 'auto' : 'smooth'
    const measure = () => tourTarget(step.target)?.getBoundingClientRect() ?? null
    const place = () => {
      const current = measure()
      setRect(current)
      const target = tourTarget(step.target)
      if (!cleared && current && target) {
        cleared = true
        const height = cardRef.current?.offsetHeight || CARD_FALLBACK_HEIGHT
        const card = dock(height)
        const scroll = clampScroll(target, clearScroll(current, { left: card.left, top: card.top, right: card.left + card.width, bottom: card.top + height }, window.innerHeight))
        if (scroll) { scroll.node.scrollBy({ top: scroll.delta, behavior }); settleLater(); return } // 스크롤이 멈춘 뒤 다시 잰다 — 말풍선은 제자리
      }
      setAnchor(current)
    }
    const settleLater = () => { clearTimeout(settle); settle = setTimeout(place, SETTLE_MS) }
    // 패널 조회·접힌 내용의 렌더는 스크롤/창 resize 없이도 대상 크기를 바꾼다.
    const onGeometryChange = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setRect(measure())); settleLater() }
    const observer = new ResizeObserver(onGeometryChange)
    const show = (target: HTMLElement | undefined) => {
      if (!target) { place(); return }
      observer.observe(target)
      const plan = scrollPlan(target)
      cleared = plan === 'none'
      if (plan === 'center') target.scrollIntoView({ block: 'center', behavior })
      else if (plan === 'nearest') target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior })
      if (plan === 'center' && !reduced) { setRect(target.getBoundingClientRect()); settleLater() } // 부드러운 스크롤이 멈춘 뒤 자리를 정한다
      else place()
    }
    const target = tourTarget(step.target)
    if (!target && step.opens) {
      // 닫힌 패널 안의 대상 — 이때만 탭을 연다. 탭 클릭의 렌더는 이 효과 뒤에 커밋되므로 프레임마다 확인한다(최대 약 1.5초)
      focusPageTarget(step.opens, t)
      setSwitched(step.opens)
      let frames = 90
      const wait = () => { const opened = tourTarget(step.target); if (opened || --frames <= 0) show(opened); else opening = requestAnimationFrame(wait) }
      wait()
    } else show(target)
    // 스크롤 중에는 스포트라이트만 프레임마다 따라가고, 말풍선 자리는 멈춘 뒤에 정한다. 리사이즈는 바로
    const onScroll = onGeometryChange
    const onResize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place) }
    window.addEventListener('resize', onResize)
    document.addEventListener('scroll', onScroll, true) // 스크롤 컨테이너·부드러운 스크롤 중에도 따라간다
    cardRef.current?.focus({ preventScroll: true })
    return () => { observer.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(opening); clearTimeout(settle); window.removeEventListener('resize', onResize); document.removeEventListener('scroll', onScroll, true) }
  }, [step, reduced, t])
  // 단계 본문·목록 펼침·탭 알림이 바뀌면 실제 높이로 — 아래 자리를 가리는지 판단이 어긋나지 않게
  useLayoutEffect(() => { if (step) setHeight(cardRef.current?.offsetHeight || CARD_FALLBACK_HEIGHT) }, [step, listOpen, switched])

  if (!step || !section) return null
  const total = sections.reduce((count, item) => count + item.steps.length, 0)
  const current = sections.slice(0, sectionIndex).reduce((count, item) => count + item.steps.length, 0) + stepIndex + 1
  const last = current >= total
  const place = dock(height)
  const top = anchor ? nudgeTop(anchor, { left: place.left, top: place.top, right: place.left + place.width, bottom: place.top + height }, window.innerHeight) : place.top
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // ←/→는 말풍선 안 어디서든(버튼·목록 포함, 마지막에서 →는 끝내지 않는다), Enter·Space는 말풍선 자체 포커스에서만 — 버튼 위의 Enter·Space는 그 버튼 몫
    if (event.key === 'ArrowRight') { event.preventDefault(); if (!last) next(); return }
    if (event.key === 'ArrowLeft') { event.preventDefault(); prev(); return }
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); next() }
  }

  return <>
    {rect && <div data-testid="tour-spotlight" aria-hidden="true" style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
      className="pointer-events-none fixed z-50 rounded-lg border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] animate-tour-pulse motion-reduce:animate-none" />}
    <div ref={cardRef} role="dialog" aria-label={t('tour.title')} aria-describedby={textId} tabIndex={-1} onKeyDown={onKeyDown}
      style={{ left: place.left, top, width: place.width }}
      className="fixed z-50 space-y-2 rounded-2xl border-2 border-primary/40 bg-popover p-3 text-sm text-popover-foreground shadow-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <div className="flex items-center gap-2">
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums"><span aria-hidden="true">🧭</span><span>{t('tour.progress', { current, total })}</span></span>
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold">{t(section.title)}</h2>
        <Button variant="ghost" size="icon-xs" className="shrink-0" aria-label={t('tour.close')} onClick={close}><X /></Button>
      </div>
      <div id={textId} aria-live="polite" className="space-y-1">
        <p className="leading-snug">{t(step.text)}</p>
        {switched && <p className="text-xs text-muted-foreground">{t(`tour.switched.${switched}`)}</p>}
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
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" aria-expanded={listOpen} aria-controls={listId} onClick={() => setListOpen((open) => !open)}
          className="flex items-center gap-1 rounded-lg px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <ChevronDown aria-hidden className={cn('size-3.5 transition-transform motion-reduce:transition-none', !listOpen && '-rotate-90')} />{t('tour.sectionList')}
        </button>
        <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => run(() => useTourStore.getState().skipSection(), 'pill.log.guideStop')}>{t('tour.skipSection')}</Button>
        <span className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" disabled={current === 1} onClick={prev}><ChevronLeft aria-hidden />{t('tour.prev')}</Button>
          <Button size="xs" onClick={next}>{last ? t('tour.finish') : <>{t('tour.next')}<ChevronRight aria-hidden /></>}</Button>
        </span>
      </div>
    </div>
  </>
}
