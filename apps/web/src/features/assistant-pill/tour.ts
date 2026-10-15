import { create } from 'zustand'
import type { TranslationKey } from '@/i18n'
import type { PageRoute } from './pageActions'
import { markSectionDone, readTourProgress } from './tutorial'

/** 한 단계 = 화면의 `data-tour` 대상 + 설명. 대상이 페이지에 없으면 건너뛴다. `opens`가 있으면 그 패널(탭)을 열어야 대상이 생긴다 — 탭이 있으면 단계로 세고, 보일 때 탭을 연다 */
export interface TourStep { target: string; text: Extract<TranslationKey, `tour.steps.${string}`>; opens?: 'materials' }
/** opens 패널을 여는 탭의 앵커 — 이 탭이 보이면 패널 안 대상도 열 수 있다 */
export const OPENERS: Record<NonNullable<TourStep['opens']>, string> = { materials: 'task-tabs' }
/** 섹션 = 화면의 한 주제. 단계가 모두 없으면 섹션째 건너뛰고, 완료는 사용자별로 기억한다 */
export interface TourSection { id: string; title: Extract<TranslationKey, `tour.sections.${string}`>; steps: readonly TourStep[] }

const ASSISTANT: TourSection = { id: 'assistant', title: 'tour.sections.assistant', steps: [{ target: 'pill', text: 'tour.steps.pill' }] }
const NAVIGATION: TourSection = { id: 'navigation', title: 'tour.sections.navigation', steps: [{ target: 'nav', text: 'tour.steps.nav' }] }

/**
 * 페이지별 섹션 — 코드 데이터. 알약은 모든 페이지에 있으므로 마지막 섹션으로 두어 투어가 비지 않게 한다. UI 안내만, 업무 절차는 넣지 않는다.
 * 자료함의 materials-library·materials-staged 앵커는 자료 패널 쪽에서 붙인다 — 아직 없으면 그 단계만 빠진다
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
      { target: 'task-tabs', text: 'tour.steps.taskTabs' },
      { target: 'materials-library', text: 'tour.steps.materialsLibrary', opens: 'materials' },
      { target: 'materials-staged', text: 'tour.steps.materialsStaged', opens: 'materials' },
    ] },
    { id: 'discussion', title: 'tour.sections.discussion', steps: [{ target: 'discussion', text: 'tour.steps.discussion' }] },
    { id: 'tags', title: 'tour.sections.tags', steps: [
      { target: 'tags', text: 'tour.steps.tags' },
      { target: 'related', text: 'tour.steps.related' },
    ] },
    { id: 'brief', title: 'tour.sections.brief', steps: [{ target: 'chat-brief', text: 'tour.steps.chatBrief' }] },
    { id: 'status', title: 'tour.sections.status', steps: [
      { target: 'task-hold', text: 'tour.steps.taskHold' },
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

// checkVisibility는 레이아웃 기준(브라우저). 없으면(jsdom) 조상의 display:none만 본다
function isShown(element: HTMLElement): boolean {
  if (typeof element.checkVisibility === 'function') return element.checkVisibility()
  for (let node: HTMLElement | null = element; node; node = node.parentElement) if (getComputedStyle(node).display === 'none') return false
  return true
}

/** 같은 id가 여럿이면(브레이크포인트별 탭 목록) 보이는 첫 번째 */
export function tourTarget(id: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)).find(isShown)
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
  /** 섹션의 마지막 단계를 지나면 그 섹션을 완료로 기록한다. 마지막 섹션이면 닫힌다 */
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
      if (sectionIndex + 1 >= sections.length) get().close()
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
