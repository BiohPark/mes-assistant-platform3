import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { getSettings } from '@/api/admin'
import { useIsDesktop, useMediaQuery } from '@/app/useMediaQuery'
import { useUiStore, type PillPos } from '@/app/uiStore'
import { SystemAssistantBody, SystemAssistantSheet } from '@/features/system-assistant/SystemAssistantDrawer'
import { useSystemAssistantChat, type SystemAssistantChat } from '@/features/system-assistant/useSystemAssistantChat'
import { useActor } from '@/app/hooks'
import { AssistantBubble } from './AssistantBubble'
import { GuideOffer } from './GuideOffer'
import { GuideTour } from './GuideTour'
import { useReplyBubble } from './replyBubble'
import { useSearchAgents } from './useSearchAgents'

const PILL = 48
const MARGIN = 8
const DRAG_THRESHOLD = 6
const STEP = 10
const BIG_STEP = 50
const WINDOW = { width: 380, height: 560 }
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 화면 안으로만 clamp — 스냅 없음 */
export function clampPos(pos: PillPos, width = PILL, height = width): PillPos {
  return {
    x: Math.min(Math.max(pos.x, MARGIN), Math.max(MARGIN, window.innerWidth - width - MARGIN)),
    y: Math.min(Math.max(pos.y, MARGIN), Math.max(MARGIN, window.innerHeight - height - MARGIN)),
  }
}

/** ≥1024: 알약 옆 비모달 창 380×560 — 왼쪽에 자리가 없으면 오른쪽, 항상 화면 안. 알약을 옮기면 따라간다 */
function AssistantWindow({ open, chat, pillRef, pos, onClose }: { open: boolean; chat: SystemAssistantChat; pillRef: RefObject<HTMLButtonElement | null>; pos: PillPos | null; onClose: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const searchAgents = useSearchAgents()
  const [place, setPlace] = useState<PillPos>({ x: MARGIN, y: MARGIN })
  useLayoutEffect(() => {
    if (!open) return
    const compute = () => {
      const rect = pillRef.current?.getBoundingClientRect()
      const left = (rect?.left ?? window.innerWidth) - WINDOW.width - MARGIN
      const x = left >= MARGIN ? left : (rect?.right ?? 0) + MARGIN
      setPlace(clampPos({ x, y: (rect?.bottom ?? window.innerHeight) - WINDOW.height }, WINDOW.width, WINDOW.height))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [open, pos, pillRef])
  useEffect(() => { if (open) ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus() }, [open])
  if (!open) return null
  return <div ref={ref} role="dialog" aria-label={t('systemAssistant.title')} data-testid="assistant-window" style={{ left: place.x, top: place.y, width: WINDOW.width, height: WINDOW.height }}
    className="fixed z-40 flex max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl border bg-background text-sm shadow-xl"
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <SystemAssistantBody chat={chat} onClose={onClose} searchAgents={searchAgents} />
  </div>
}

interface Drag { pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean; frame: number; last: PillPos }

/**
 * AI 도우미 알약 — 상단 버튼을 대체한다(U4). ≥768 pointer 드래그(6px 임계·clamp)·화살표 10px·Shift 50px·Home 초기화, <768 우하단 고정. 재클릭·Esc로 닫히면 포커스가 알약으로 돌아온다.
 * 끌기 중에는 pointer capture 아래서 프레임마다(rAF) transform만 바꾸고, 놓을 때 한 번 clamp해 저장한다 — 이동마다 스토어(persist)·리렌더를 치지 않는다
 */
export function AssistantPill() {
  const t = useT()
  const { userId } = useActor()
  const open = useUiStore((state) => state.assistantOpen)
  const setOpen = useUiStore((state) => state.setAssistantOpen)
  const pos = useUiStore((state) => state.pillPos)
  const setPos = useUiStore((state) => state.setPillPos)
  const movable = useMediaQuery('(min-width: 768px)')
  const desktop = useIsDesktop()
  const chat = useSystemAssistantChat(open)
  const image = useQuery({ queryKey: ['settings'], queryFn: getSettings }).data?.assistantImageFileId
  const pillRef = useRef<HTMLButtonElement>(null)
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const close = useCallback(() => { setOpen(false); pillRef.current?.focus() }, [setOpen])
  useReplyBubble() // 내 요청의 끝을 다른 화면에서 말풍선으로 — 알약이 있는 창(본창)에서만

  useEffect(() => {
    const reclamp = () => { const current = useUiStore.getState().pillPos; if (current) setPos(clampPos(current)) }
    reclamp() // 마운트·persist 복원 때도 — 더 큰 화면에서 저장한 좌표가 화면 밖에 남지 않게
    window.addEventListener('resize', reclamp)
    window.addEventListener('orientationchange', reclamp)
    return () => { window.removeEventListener('resize', reclamp); window.removeEventListener('orientationchange', reclamp) }
  }, [setPos])

  const currentPos = (): PillPos => {
    if (pos) return pos
    const rect = pillRef.current?.getBoundingClientRect()
    return { x: rect?.left ?? 0, y: rect?.top ?? 0 }
  }
  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (!movable || event.button !== 0) return
    event.preventDefault() // 마우스 호환 이벤트를 막아 아래 요소(링크·텍스트)의 네이티브 드래그가 pointercancel로 끌기를 끊지 못하게 — 포커스는 직접 준다
    event.currentTarget.focus()
    const origin = currentPos()
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: origin.x, originY: origin.y, moved: false, frame: 0, last: origin }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    state.moved = true
    state.last = clampPos({ x: state.originX + dx, y: state.originY + dy }) // 가장자리 clamp는 끌기 중에도
    if (!state.frame) state.frame = requestAnimationFrame(() => {
      state.frame = 0
      if (pillRef.current) pillRef.current.style.transform = `translate3d(${state.last.x - state.originX}px, ${state.last.y - state.originY}px, 0)`
    })
  }
  function onPointerEnd(event: PointerEvent<HTMLButtonElement>) {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null
    cancelAnimationFrame(state.frame)
    if (!state.moved) return
    suppressClick.current = true // 끌기 뒤의 click은 토글이 아니다
    setPos(state.last) // 저장은 한 번 — left/top이 바뀌는 같은 커밋에서 transform을 거둔다
    if (pillRef.current) pillRef.current.style.transform = ''
  }
  function onClick() {
    if (suppressClick.current) { suppressClick.current = false; return }
    if (open) close()
    else setOpen(true)
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!movable) return
    if (event.key === 'Home') { event.preventDefault(); setPos(null); return }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
    if (!delta) return
    event.preventDefault()
    const step = event.shiftKey ? BIG_STEP : STEP
    const from = currentPos()
    setPos(clampPos({ x: from.x + delta[0]! * step, y: from.y + delta[1]! * step }))
  }

  const placed = movable && pos
  // 기본 위치는 사이드바 열 하단(왼쪽) — 우하단은 입력창 전송 버튼·메뉴와 겹쳐 클릭을 가로챈다(CI 390px). 사이드바는 모든 폭에 있고 하단이 비어 있다(AppShell aside pb-16)
  const docked = { left: desktop ? 16 : 4, bottom: 16 }
  return <>
    <button ref={pillRef} type="button" data-testid="assistant-pill" data-tour="pill" aria-label={open ? t('pill.close') : t('pill.open')} aria-expanded={open} aria-haspopup="dialog"
      title={movable ? t('pill.moveHint') : undefined} style={placed ? { left: pos.x, top: pos.y } : docked}
      className={cn('fixed z-40 flex size-12 touch-none items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-2 ring-background select-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', movable && 'cursor-grab active:cursor-grabbing')}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onKeyDown={onKeyDown} onClick={onClick}>
      {image ? <img src={`/api/settings/assistant-image?v=${encodeURIComponent(image)}`} alt={t('pill.characterAlt')} draggable={false} className="size-full rounded-full object-cover" /> : <Sparkles className="size-5" aria-hidden />}
    </button>
    <AssistantBubble pillRef={pillRef} pos={pos} />
    <GuideOffer userId={userId} pillRef={pillRef} pos={pos} />
    <GuideTour userId={userId} pillRef={pillRef} />
    {desktop ? <AssistantWindow open={open} chat={chat} pillRef={pillRef} pos={pos} onClose={close} /> : <SystemAssistantSheet open={open} chat={chat} onClose={() => setOpen(false)} returnFocus={() => pillRef.current?.focus()} />}
  </>
}
