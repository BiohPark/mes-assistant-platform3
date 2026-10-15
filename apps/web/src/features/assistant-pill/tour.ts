import { create } from 'zustand'
import type { TranslationKey } from '@/i18n'
import type { PageRoute } from './pageActions'

/** 한 단계 = 화면의 `data-tour` 대상 + 설명. 대상이 페이지에 없으면 건너뛴다 */
export interface TourStep { target: string; text: Extract<TranslationKey, `tour.steps.${string}`> }

/** 페이지별 단계 — 코드 데이터. 알약은 모든 페이지에 있으므로 마지막 단계로 두어 투어가 비지 않게 한다. UI 안내만, 업무 절차는 넣지 않는다 */
export const TOUR_STEPS: Record<PageRoute, readonly TourStep[]> = {
  hub: [
    { target: 'hub-view', text: 'tour.steps.hubView' },
    { target: 'hub-search', text: 'tour.steps.hubSearch' },
    { target: 'hub-cards', text: 'tour.steps.hubCards' },
    { target: 'nav', text: 'tour.steps.nav' },
    { target: 'pill', text: 'tour.steps.pill' },
  ],
  conversation: [
    { target: 'composer', text: 'tour.steps.composer' },
    { target: 'related', text: 'tour.steps.related' },
    { target: 'task-tabs', text: 'tour.steps.taskTabs' },
    { target: 'pill', text: 'tour.steps.pill' },
  ],
  sr: [
    { target: 'sr-new', text: 'tour.steps.srNew' },
    { target: 'sr-list', text: 'tour.steps.srList' },
    { target: 'sr-search', text: 'tour.steps.srSearch' },
    { target: 'sr-table', text: 'tour.steps.srTable' },
    { target: 'pill', text: 'tour.steps.pill' },
  ],
  myWork: [
    { target: 'my-work-completed', text: 'tour.steps.myWorkCompleted' },
    { target: 'my-work-list', text: 'tour.steps.myWorkList' },
    { target: 'pill', text: 'tour.steps.pill' },
  ],
  admin: [
    { target: 'admin-new-assistant', text: 'tour.steps.adminNewAssistant' },
    { target: 'admin-settings', text: 'tour.steps.adminSettings' },
    { target: 'admin-users', text: 'tour.steps.adminUsers' },
    { target: 'admin-diagnostics', text: 'tour.steps.adminDiagnostics' },
    { target: 'pill', text: 'tour.steps.pill' },
  ],
  other: [
    { target: 'nav', text: 'tour.steps.nav' },
    { target: 'pill', text: 'tour.steps.pill' },
  ],
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
  /** 대상 대기가 끝난 뒤 확정한 단계 — 대기 중에는 비워 깜빡임을 막는다 */
  steps: readonly TourStep[]
  index: number
  /** 최대 1.5초 기다린 뒤 보이는 대상만 확정한다. 하나도 없으면 닫는다 */
  start: (route: PageRoute) => void
  next: () => void
  prev: () => void
  close: () => void
}

export const useTourStore = create<TourState>()((set, get) => {
  let cancelPending: (() => void) | undefined
  return {
    route: null,
    steps: [],
    index: 0,
    start: (route) => {
      cancelPending?.()
      const candidates = TOUR_STEPS[route]
      const shownSteps = () => candidates.filter((step) => tourTarget(step.target))
      const ready = shownSteps()
      if (ready.length === candidates.length) {
        set({ route, steps: ready, index: 0 })
        return
      }
      // 도우미 창 닫기·페이지 렌더·CSS 전환을 다음 프레임마다 확인한다.
      // 타이머는 백그라운드 탭처럼 rAF가 멈춘 경우에도 대기를 끝낸다.
      let frame = 0
      const finish = () => {
        cancelPending?.()
        const steps = shownSteps()
        set({ route: steps.length ? route : null, steps, index: 0 })
      }
      const timer = setTimeout(finish, 1500)
      cancelPending = () => {
        cancelAnimationFrame(frame)
        clearTimeout(timer)
        cancelPending = undefined
      }
      const poll = () => {
        if (shownSteps().length === candidates.length) finish()
        else frame = requestAnimationFrame(poll)
      }
      frame = requestAnimationFrame(poll)
      set({ route, steps: [], index: 0 })
    },
    next: () => {
      const { index, steps } = get()
      if (index + 1 >= steps.length) get().close()
      else set({ index: index + 1 })
    },
    prev: () => set((state) => ({ index: Math.max(0, state.index - 1) })),
    close: () => { cancelPending?.(); set({ route: null, steps: [], index: 0 }) },
  }
})
