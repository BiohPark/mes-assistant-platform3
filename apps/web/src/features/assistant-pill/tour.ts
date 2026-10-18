import { create } from 'zustand'
import type { TranslationKey } from '@/i18n'
import type { PageRoute } from './pageActions'
import { markSectionDone, readTourProgress, saveGuideOffer } from './tutorial'

/** 한 단계 = 화면의 `data-tour` 대상 + 설명. 대상이 페이지에 없으면 건너뛴다. `opens`가 있으면 연결 자료를 열거나 입력창에 초점을 옮긴다 */
export interface TourStep { target: string; text: Extract<TranslationKey, `tour.steps.${string}`>; opens?: 'materials' | 'chat' }
/** 연결 자료 버튼이 보이면 패널 내부의 단계도 포함한다. chat은 입력창을 가리킨다 */
export const OPENERS: Record<NonNullable<TourStep['opens']>, string> = { materials: 'linked-materials', chat: 'linked-materials' }
/** 섹션 = 화면의 한 주제. 단계가 모두 없으면 섹션째 건너뛰고, 완료는 사용자별로 기억한다 */
export interface TourSection { id: string; title: Extract<TranslationKey, `tour.sections.${string}`>; steps: readonly TourStep[] }

const ASSISTANT: TourSection = { id: 'assistant', title: 'tour.sections.assistant', steps: [{ target: 'pill', text: 'tour.steps.pill' }] }
const NAVIGATION: TourSection = { id: 'navigation', title: 'tour.sections.navigation', steps: [{ target: 'nav', text: 'tour.steps.nav' }] }

/**
 * 페이지별 섹션 — 코드 데이터. 알약은 모든 페이지에 있으므로 마지막 섹션으로 두어 투어가 비지 않게 한다. UI 안내만, 업무 절차는 넣지 않는다.
 * materials-library·materials-conversations 앵커는 자료 패널이, materials-staged는 입력창(Composer)의 첨부 칩 줄(칩이 없으면 📎 버튼)이 붙인다.
 * materials-staged는 입력창 칩 줄(비어 있으면 첨부 버튼)을 짚는다.
 */
export const TOUR_SECTIONS: Record<PageRoute, readonly TourSection[]> = {
  hub: [
    { id: 'hub', title: 'tour.sections.hub', steps: [
      { target: 'hub-view', text: 'tour.steps.hubView' },
      { target: 'hub-search', text: 'tour.steps.hubSearch' },
      { target: 'hub-cards', text: 'tour.steps.hubCards' },
    ] },
    { id: 'kanban', title: 'tour.sections.kanban', steps: [
      { target: 'kanban-filters', text: 'tour.steps.kanbanFilters' },
      { target: 'kanban-ai-filter', text: 'tour.steps.kanbanAiFilter' },
      { target: 'kanban-columns', text: 'tour.steps.kanbanColumns' },
      { target: 'kanban-card', text: 'tour.steps.kanbanCard' },
    ] },
    NAVIGATION,
    ASSISTANT,
  ],
  conversation: [
    { id: 'basics', title: 'tour.sections.basics', steps: [
      { target: 'composer', text: 'tour.steps.composer' },
      { target: 'model', text: 'tour.steps.model' },
      { target: 'chat-search', text: 'tour.steps.chatSearch' },
      { target: 'chat-toc', text: 'tour.steps.chatToc' },
      { target: 'quick-switch', text: 'tour.steps.quickSwitch' },
      { target: 'popout', text: 'tour.steps.popout' },
    ] },
    { id: 'materials', title: 'tour.sections.materials', steps: [
      { target: 'linked-materials', text: 'tour.steps.taskTabs' },
      { target: 'materials-library', text: 'tour.steps.materialsLibrary', opens: 'materials' },
      { target: 'materials-conversations', text: 'tour.steps.materialsConversations', opens: 'materials' },
      { target: 'materials-staged', text: 'tour.steps.materialsStaged', opens: 'chat' },
    ] },
    { id: 'discussion', title: 'tour.sections.discussion', steps: [{ target: 'discussion', text: 'tour.steps.discussion' }] },
    { id: 'tags', title: 'tour.sections.tags', steps: [
      { target: 'tags', text: 'tour.steps.tags' },
    ] },
    { id: 'brief', title: 'tour.sections.brief', steps: [{ target: 'chat-brief', text: 'tour.steps.chatBrief' }] },
    { id: 'status', title: 'tour.sections.status', steps: [
      { target: 'task-more', text: 'tour.steps.taskHold' },
      { target: 'task-complete', text: 'tour.steps.taskComplete' },
    ] },
    ASSISTANT,
  ],
  sr: [
    { id: 'sr', title: 'tour.sections.sr', steps: [
      { target: 'sr-new', text: 'tour.steps.srNew' },
      { target: 'sr-list', text: 'tour.steps.srList' },
      { target: 'sr-search', text: 'tour.steps.srSearch' },
      { target: 'sr-table', text: 'tour.steps.srTable' },
    ] },
    ASSISTANT,
  ],
  myWork: [
    { id: 'myWork', title: 'tour.sections.myWork', steps: [
      { target: 'my-work-completed', text: 'tour.steps.myWorkCompleted' },
      { target: 'my-work-list', text: 'tour.steps.myWorkList' },
    ] },
    ASSISTANT,
  ],
  admin: [
    { id: 'admin', title: 'tour.sections.admin', steps: [
      { target: 'admin-new-assistant', text: 'tour.steps.adminNewAssistant' },
      { target: 'admin-settings', text: 'tour.steps.adminSettings' },
      { target: 'admin-users', text: 'tour.steps.adminUsers' },
      { target: 'admin-diagnostics', text: 'tour.steps.adminDiagnostics' },
    ] },
    ASSISTANT,
  ],
  other: [NAVIGATION, ASSISTANT],
}

// checkVisibility는 레이아웃 기준(브라우저). 없으면(jsdom) 조상의 display:none만 본다. 숨은 탭(inert)은 어느 쪽이든 제외
function isShown(element: HTMLElement): boolean {
  if (element.closest('[inert]')) return false // 숨은 탭(S15)의 화면
  if (typeof element.checkVisibility === 'function') return element.checkVisibility()
  for (let node: HTMLElement | null = element; node; node = node.parentElement) if (getComputedStyle(node).display === 'none') return false
  return true
}

/** 같은 id가 여럿이면(브레이크포인트별 탭 목록) 보이는 첫 번째 */
export function tourTarget(id: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)).find(isShown)
}

/** 말풍선과 화면 가장자리·알약·대상 사이 여백 */
export const COACH_MARGIN = 8
/** 넓은 화면의 말풍선 폭 */
export const DOCK_WIDTH = 340

type Box = { left: number; top: number; right: number; bottom: number }
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))
/** 여백까지 닿으면 가린 것으로 본다 */
const covers = (target: Box, card: Box) =>
  target.left - COACH_MARGIN < card.right && target.right + COACH_MARGIN > card.left && target.top - COACH_MARGIN < card.bottom && target.bottom + COACH_MARGIN > card.top

/**
 * 말풍선 자리(S14-HH) — 도우미 창 자리: 알약 왼쪽에 들어가면 왼쪽, 아니면 오른쪽, 알약 아래끝에 맞춘다(창과 같은 규칙).
 * 양옆 모두 모자라면(좁은 화면) 알약 바로 위에 좌우 여백만 두고, 위가 모자라면 알약 아래. 늘 화면 안. 대상을 따라 움직이지 않는다
 */
export function dockPlace(pill: Box | null, card: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number; width: number } {
  const maxTop = viewport.height - card.height - COACH_MARGIN
  if (!pill) return { left: Math.max(COACH_MARGIN, viewport.width - card.width - COACH_MARGIN), top: clamp(maxTop, COACH_MARGIN, maxTop), width: card.width }
  const top = clamp(pill.bottom - card.height, COACH_MARGIN, maxTop)
  const left = pill.left - COACH_MARGIN - card.width
  if (left >= COACH_MARGIN) return { left, top, width: card.width }
  const right = pill.right + COACH_MARGIN
  if (right + card.width + COACH_MARGIN <= viewport.width) return { left: right, top, width: card.width }
  const width = viewport.width - COACH_MARGIN * 2
  const above = pill.top - COACH_MARGIN - card.height
  return { left: COACH_MARGIN, top: clamp(above >= COACH_MARGIN ? above : pill.bottom + COACH_MARGIN, COACH_MARGIN, maxTop), width }
}

/**
 * 대상이 말풍선에 가리면 대상을 말풍선 위로(위가 모자라면 아래로) 옮길 세로 스크롤량 — 양수면 내용을 아래로 스크롤(대상이 올라간다).
 * 안 가리거나 들어갈 자리가 없으면 0. 말풍선은 움직이지 않는다
 */
export function clearScroll(target: Box, card: Box, viewport: number): number {
  if (!covers(target, card)) return 0
  const height = target.bottom - target.top
  if (height <= card.top - COACH_MARGIN * 2) return target.bottom - (card.top - COACH_MARGIN)
  if (height <= viewport - card.bottom - COACH_MARGIN * 2) return target.top - (card.bottom + COACH_MARGIN)
  return 0
}

/**
 * 스크롤로 비킬 수 없는 대상(fixed·sticky·스크롤 끝)만 — 말풍선을 같은 가로 자리에서 세로로만 대상 위(모자라면 아래)로 옮긴 top.
 * 자리가 없거나 화면의 반대쪽 절반으로 건너가야 하면(큰 대상) 그대로 — 일부를 가리더라도 알약 곁을 떠나지 않는다
 */
export function nudgeTop(target: Box, card: Box, viewport: number): number {
  if (!covers(target, card)) return card.top
  const height = card.bottom - card.top
  const lower = (top: number) => top + height / 2 > viewport / 2
  const fits = (top: number) => top >= COACH_MARGIN && top + height <= viewport - COACH_MARGIN && lower(top) === lower(card.top)
  const above = target.top - COACH_MARGIN - height
  if (fits(above)) return above
  const below = target.bottom + COACH_MARGIN
  return fits(below) ? below : card.top
}

/** 대상의 가장 가까운 스크롤 조상(없으면 문서)과 실제로 움직일 수 있는 만큼으로 줄인 스크롤량. 움직일 수 없으면 null */
export function clampScroll(target: HTMLElement, delta: number): { node: Element; delta: number } | null {
  if (!delta) return null
  let node: Element | null = target.parentElement
  for (; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) break
  }
  node ??= document.scrollingElement
  if (!node) return null
  const moved = clamp(delta, -node.scrollTop, node.scrollHeight - node.clientHeight - node.scrollTop)
  return moved ? { node, delta: moved } : null
}

/**
 * 대상으로 갈 스크롤 — fixed·sticky(조상 포함)는 스크롤해도 제자리라 움직이지 않는다(none).
 * 화면 밖이면 가운데로(center), 화면 안이면 nearest(이미 보이면 제자리 — 안쪽 스크롤 영역에 가린 경우만 조금 움직인다)
 */
export function scrollPlan(target: HTMLElement): 'none' | 'center' | 'nearest' {
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    const { position } = getComputedStyle(node)
    if (position === 'fixed' || position === 'sticky') return 'none'
  }
  const rect = target.getBoundingClientRect()
  return rect.top < 0 || rect.bottom > window.innerHeight || rect.left < 0 || rect.right > window.innerWidth ? 'center' : 'nearest'
}

interface TourState {
  /** 대상 대기 중에도 route를 두어 Esc·페이지 이동으로 취소할 수 있다 */
  route: PageRoute | null
  userId: string
  /** 대상 대기가 끝난 뒤 확정한 섹션(보이는 단계만, 빈 섹션 제외) — 대기 중에는 비워 깜빡임을 막는다 */
  sections: readonly TourSection[]
  sectionIndex: number
  stepIndex: number
  /** 이 사용자가 이 페이지에서 끝까지 본 섹션 id */
  done: readonly string[]
  /** 최대 1.5초 기다린 뒤 보이는 대상만 확정한다. 하나도 없으면 닫는다. 완료하지 않은 첫 섹션에서 시작한다 */
  start: (route: PageRoute, userId: string) => void
  /** 섹션의 마지막 단계를 지나면 그 섹션을 완료로 기록한다. 마지막 섹션이면 페이지 제안을 done으로 남기고 닫힌다 */
  next: () => void
  prev: () => void
  /** 현재 섹션을 완료로 기록하지 않고 다음 섹션으로. 마지막이면 닫힌다 */
  skipSection: () => void
  /** 섹션 목록에서 고르기 — 완료한 섹션의 '다시 보기'도 이것 */
  goToSection: (index: number) => void
  close: () => void
}

export const useTourStore = create<TourState>()((set, get) => {
  let cancelPending: (() => void) | undefined
  const closed = { route: null, sections: [], sectionIndex: 0, stepIndex: 0, done: [] } as const
  const finishSection = () => {
    const { route, userId, sections, sectionIndex } = get()
    const section = sections[sectionIndex]
    if (!route || !section) return
    set({ done: markSectionDone(userId, route, section.id) })
  }
  return {
    route: null,
    userId: '',
    sections: [],
    sectionIndex: 0,
    stepIndex: 0,
    done: [],
    start: (route, userId) => {
      cancelPending?.()
      const candidates = TOUR_SECTIONS[route]
      const total = candidates.reduce((count, section) => count + section.steps.length, 0)
      const available = (step: TourStep) => !!tourTarget(step.target) || (!!step.opens && !!tourTarget(OPENERS[step.opens]))
      const shown = () => candidates.map(section => ({ ...section, steps: section.steps.filter(available) })).filter(section => section.steps.length > 0)
      const shownCount = (sections: readonly TourSection[]) => sections.reduce((count, section) => count + section.steps.length, 0)
      const done = readTourProgress(userId, route)
      const resolve = (sections: readonly TourSection[]) => {
        const first = sections.findIndex(section => !done.includes(section.id))
        set({ route: sections.length ? route : null, sections, sectionIndex: first < 0 ? 0 : first, stepIndex: 0, done })
      }
      const ready = shown()
      if (shownCount(ready) === total) { set({ userId }); resolve(ready); return }
      // 도우미 창 닫기·페이지 렌더·CSS 전환을 다음 프레임마다 확인한다.
      // 타이머는 백그라운드 탭처럼 rAF가 멈춘 경우에도 대기를 끝낸다.
      let frame = 0
      const finish = () => { cancelPending?.(); resolve(shown()) }
      const timer = setTimeout(finish, 1500)
      cancelPending = () => {
        cancelAnimationFrame(frame)
        clearTimeout(timer)
        cancelPending = undefined
      }
      const poll = () => {
        if (shownCount(shown()) === total) finish()
        else frame = requestAnimationFrame(poll)
      }
      frame = requestAnimationFrame(poll)
      set({ route, userId, sections: [], sectionIndex: 0, stepIndex: 0, done })
    },
    next: () => {
      const { sections, sectionIndex, stepIndex } = get()
      const section = sections[sectionIndex]
      if (!section) return
      if (stepIndex + 1 < section.steps.length) { set({ stepIndex: stepIndex + 1 }); return }
      finishSection()
      if (sectionIndex + 1 >= sections.length) {
        const { route, userId } = get()
        if (route) saveGuideOffer(userId, route, 'done') // 끝까지 봤다 — 이 페이지는 다시 제안하지 않는다
        get().close()
      }
      else set({ sectionIndex: sectionIndex + 1, stepIndex: 0 })
    },
    prev: () => set((state) => {
      if (state.stepIndex > 0) return { stepIndex: state.stepIndex - 1 }
      if (state.sectionIndex === 0) return {}
      const previous = state.sections[state.sectionIndex - 1]!
      return { sectionIndex: state.sectionIndex - 1, stepIndex: previous.steps.length - 1 }
    }),
    skipSection: () => {
      const { sections, sectionIndex } = get()
      if (sectionIndex + 1 >= sections.length) get().close()
      else set({ sectionIndex: sectionIndex + 1, stepIndex: 0 })
    },
    goToSection: (index) => { if (index >= 0 && index < get().sections.length) set({ sectionIndex: index, stepIndex: 0 }) },
    close: () => { cancelPending?.(); set(closed) },
  }
})
