import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** 상단 탭 하나 — 위치(href = 경로+쿼리+해시)만 기억한다. 화면 상태는 살려 둔 렌더가 들고 있다 */
export interface Tab { id: string; href: string }
export interface TabsState {
  userId: string | null
  tabs: Tab[]
  activeId: string
  nextId: number
  /** 렌더를 살려 둔 탭 id, 최근에 본 것이 뒤. 저장하지 않는다(새로고침하면 활성 탭만 다시 그린다) */
  seen: string[]
}
export type NavigationKind = 'PUSH' | 'REPLACE' | 'POP'

/** 홈 탭(고정) id. 다른 탭은 1부터 늘어나는 숫자 — 렌더 순서를 만든 순서로 고정하는 데 쓴다 */
export const HOME_ID = '0'
/** 동시에 살려 두는 탭 수. 넘으면 가장 오래 안 본 탭의 렌더를 내린다(탭 칩은 남는다) */
export const MAX_ALIVE = 8

export const pathOf = (href: string) => href.replace(/[?#].*$/, '') || '/'

export const initialTabs = (home: string, userId: string | null = null): TabsState =>
  ({ userId, tabs: [{ id: HOME_ID, href: home }], activeId: HOME_ID, nextId: 1, seen: [] })

const withHref = (state: TabsState, id: string, href: string): TabsState =>
  ({ ...state, tabs: state.tabs.map(tab => tab.id === id && tab.href !== href ? { ...tab, href } : tab) })

function activate(state: TabsState, id: string): TabsState {
  const seen = [...state.seen.filter(item => item !== id), id]
  return { ...state, activeId: id, seen: seen.slice(-MAX_ALIVE) } // 맨 뒤가 활성 탭이라 빠지지 않는다
}

/**
 * 주소로 가기: 활성 탭과 같은 경로면 그 탭의 위치만, 다른 탭과 같은 경로면 그 탭을 활성화, 처음이면 새 탭.
 * `bare`(PUSH)로 경로만 가리키면(사이드바 메뉴) 그 탭에 남은 위치를 되살리도록 `redirect`를 돌려준다
 */
export function visit(state: TabsState, href: string, bare: boolean): { state: TabsState; redirect?: string } {
  const path = pathOf(href)
  const current = state.tabs.find(tab => tab.id === state.activeId)
  if (current && pathOf(current.href) === path) return { state: activate(withHref(state, current.id, href), current.id) }
  const existing = state.tabs.find(tab => pathOf(tab.href) === path)
  if (existing) {
    if (bare && href === path && existing.href !== href) return { state: activate(state, existing.id), redirect: existing.href }
    return { state: activate(withHref(state, existing.id, href), existing.id) }
  }
  const id = String(state.nextId)
  return { state: activate({ ...state, nextId: state.nextId + 1, tabs: [...state.tabs, { id, href }] }, id) }
}

/** 탭이 스스로 다른 주소로 바뀐다(REPLACE·리다이렉트). 같은 경로의 다른 탭이 있으면 이 탭을 닫고 그 탭으로 합친다. 홈 탭은 경로가 바뀌지 않는다 */
export function retarget(state: TabsState, id: string, href: string): TabsState {
  const tab = state.tabs.find(item => item.id === id)
  if (!tab) return state
  const path = pathOf(href)
  if (pathOf(tab.href) === path) return withHref(state, id, href)
  if (id === HOME_ID) return state
  const other = state.tabs.find(item => item.id !== id && pathOf(item.href) === path)
  if (!other) return withHref(state, id, href)
  const merged = withHref({ ...state, tabs: state.tabs.filter(item => item.id !== id), seen: state.seen.filter(item => item !== id) }, other.id, href)
  return state.activeId === id ? activate(merged, other.id) : merged
}

/** 주소창(라우터)의 이동을 탭에 반영한다. REPLACE는 활성 탭이 바뀐 것(홈 탭이면 새 탭), 나머지는 visit */
export function follow(state: TabsState, href: string, kind: NavigationKind): { state: TabsState; redirect?: string } {
  if (kind === 'REPLACE' && state.activeId !== HOME_ID && state.tabs.some(tab => tab.id === state.activeId)) {
    const next = retarget(state, state.activeId, href)
    return { state: activate(next, next.activeId) }
  }
  return visit(state, href, kind === 'PUSH')
}

/** 탭 닫기 — 활성 탭이면 오른쪽(없으면 왼쪽) 탭을 활성화한다. 홈 탭은 닫히지 않는다 */
export function close(state: TabsState, id: string): TabsState {
  const index = state.tabs.findIndex(tab => tab.id === id)
  if (id === HOME_ID || index < 0) return state
  const tabs = state.tabs.filter(tab => tab.id !== id)
  const rest = { ...state, tabs, seen: state.seen.filter(item => item !== id) }
  if (state.activeId !== id) return rest
  return activate(rest, (tabs[index] ?? tabs[index - 1])!.id)
}

/** 다른 탭 닫기 — 홈과 이 탭만 남기고 이 탭을 활성화한다 */
export function closeOthers(state: TabsState, id: string): TabsState {
  const keep = (tab: Tab) => tab.id === HOME_ID || tab.id === id
  return activate({ ...state, tabs: state.tabs.filter(keep), seen: state.seen.filter(item => item === HOME_ID || item === id) }, id)
}

/** 드래그로 순서 바꾸기 — 홈 탭은 맨 앞 고정 */
export function move(state: TabsState, id: string, toIndex: number): TabsState {
  const from = state.tabs.findIndex(tab => tab.id === id)
  if (id === HOME_ID || from < 0) return state
  const tabs = state.tabs.filter(tab => tab.id !== id)
  tabs.splice(Math.min(Math.max(toIndex, 1), tabs.length), 0, state.tabs[from]!)
  return { ...state, tabs }
}

/** 다른 사용자로 로그인했거나 홈(역할)이 바뀌었으면 새로 시작한다 — 브라우저 탭의 sessionStorage가 로그인을 넘어 남기 때문 */
export function ensureUser(state: TabsState, userId: string, home: string): TabsState {
  const first = state.tabs[0]
  if (state.userId === userId && first?.id === HOME_ID && pathOf(first.href) === pathOf(home)) return state
  return initialTabs(home, userId)
}

/** 브라우저 탭별(sessionStorage) 탭 목록. 저장소를 못 쓰면 메모리로만 동작한다 */
export const useTabsStore = create<TabsState>()(persist(() => initialTabs('/'), {
  name: 'mes-tabs',
  version: 1,
  storage: createJSONStorage(() => sessionStorage),
  partialize: ({ userId, tabs, activeId, nextId }) => ({ userId, tabs, activeId, nextId }),
}))

export const updateTabs = (change: (state: TabsState) => TabsState) => useTabsStore.setState(change(useTabsStore.getState()), true)
