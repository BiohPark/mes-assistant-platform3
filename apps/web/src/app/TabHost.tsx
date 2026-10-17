import { memo, use, useLayoutEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  createPath, parsePath, useLocation, useNavigate, useNavigationType,
  UNSAFE_LocationContext as LocationContext, UNSAFE_NavigationContext as NavigationContext,
  type Location, type NavigationType, type To,
} from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { PageView } from './pageRoutes'
import { TabActiveContext } from './tabActive'
import { ensureUser, follow, pathOf, retarget, updateTabs, useTabsStore, type Tab } from './tabs'
import { TabStrip } from './TabStrip'

type TabLocation = { location: Location; navigationType: NavigationType }

/** 숨은 탭 — 레이아웃·스크롤 위치는 그대로 두고(display:none은 스크롤을 잃는다) 그리지도, 읽히지도, 누르지도 않게 */
const HIDDEN: CSSProperties = { visibility: 'hidden', contentVisibility: 'hidden' }

/**
 * 상단 탭 MDI(S15): 열린 탭마다 그 탭의 위치로 화면을 렌더해 살려 두고(최근 본 MAX_ALIVE개), 보이는 것은 활성 탭 하나.
 * 주소창이 정본 — 라우터의 이동(메뉴·링크·뒤로가기)을 follow로 탭에 반영하고, 탭 칩은 그 탭의 위치로 이동한다
 */
export function TabHost({ home, userId, single = false }: { home: string; userId: string; single?: boolean }) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const href = location.pathname + location.search + location.hash
  const { tabs, activeId, seen } = useTabsStore(useShallow(({ tabs, activeId, seen }) => ({ tabs, activeId, seen })))
  const [locations] = useState(() => new Map<string, { href: string; value: TabLocation }>())

  useLayoutEffect(() => {
    if (single) return // 탭 줄 없는 화면(모바일·팝업)은 지금처럼 화면 하나 — 탭을 열거나 바꾸지 않는다
    const result = follow(ensureUser(useTabsStore.getState(), userId, home), href, navigationType)
    updateTabs(() => result.state)
    for (const id of locations.keys()) if (!result.state.tabs.some(tab => tab.id === id)) locations.delete(id)
    if (result.redirect) void navigate(result.redirect, { replace: true })
  }, [single, location.key, href, navigationType, userId, home, navigate, locations])
  const current = useMemo(() => ({ location, navigationType }), [location, navigationType])

  // 활성 탭은 라우터의 위치(키·state·이동 종류 포함)를 그대로, 숨은 탭은 마지막 위치를 유지한다 — 숨은 탭은 같은 주소면 같은 객체라 화면이 다시 반응하지 않는다
  const locationOf = (tab: Tab): TabLocation => {
    const known = locations.get(tab.id)
    // 같은 경로(쿼리만 바뀜)는 탭 저장 전에 바로 따른다 — 이동과 같은 커밋에 화면이 바뀌어야 이동 뒤 포커스 같은 후속 동작이 맞는다
    // 같은 주소라도 새 기록(뒤로가기·state만 다른 이동)이면 따른다 — 화면이 location.key·state로 초기화를 판단한다
    if (tab.id === activeId && pathOf(tab.href) === pathOf(href)) {
      if (known?.value.location !== location || known.value.navigationType !== navigationType) locations.set(tab.id, { href, value: current })
    } else if (known?.href !== tab.href) {
      locations.set(tab.id, { href: tab.href, value: { location: { pathname: '/', search: '', hash: '', ...parsePath(tab.href), state: null, key: `tab-${tab.id}-${tab.href}` }, navigationType: 'REPLACE' as NavigationType } })
    }
    return locations.get(tab.id)!.value
  }
  // 렌더 순서는 탭을 만든 순서로 고정 — 칩을 끌어 순서를 바꿔도 화면 DOM은 옮기지 않는다(옮기면 스크롤·포커스를 잃는다)
  const alive = tabs.filter(tab => seen.includes(tab.id)).sort((a, b) => Number(a.id) - Number(b.id))

  // 화면 하나 모드도 같은 자리(활성 탭 id)에 그린다 — 창 폭이 768px을 넘나들어도 보고 있는 화면이 다시 마운트되지 않는다
  return <>
    {!single && <TabStrip />}
    <div className="relative min-h-0 flex-1">
      {single
        ? <TabPanel key={activeId} id={activeId} active single value={current} />
        : alive.map(tab => <TabPanel key={tab.id} id={tab.id} active={tab.id === activeId} value={locationOf(tab)} />)}
    </div>
  </>
}

const TabPanel = memo(function TabPanel({ id, active, single = false, value }: { id: string; active: boolean; single?: boolean; value: TabLocation }) {
  return <div role={single ? undefined : 'tabpanel'} id={`tabpanel-${id}`} aria-labelledby={single ? undefined : `tab-${id}`} data-tab-panel={id} inert={!active} aria-hidden={active ? undefined : true}
    style={active ? undefined : HIDDEN} className="absolute inset-0 flex min-h-0 flex-col">
    <TabActiveContext value={active}><TabContent id={id} value={value} /></TabActiveContext>
  </div>
})

const TabContent = memo(function TabContent({ id, value }: { id: string; value: TabLocation }) {
  return <TabNavigation id={id}><LocationContext value={value}><PageView /></LocationContext></TabNavigation>
})

/**
 * 숨은 탭의 이동은 주소창을 건드리지 않는다 — 리다이렉트(REPLACE)나 같은 경로(쿼리) 이동은 그 탭에만 반영하고, 다른 경로로의 PUSH는 버린다.
 * (숨은 탭은 inert라 사람이 누를 수 없다. 늦게 끝난 조회의 리다이렉트가 보고 있는 탭을 빼앗지 않게)
 */
function TabNavigation({ id, children }: { id: string; children: ReactNode }) {
  const context = use(NavigationContext)
  const value = useMemo(() => {
    const { navigator } = context
    const hidden = (to: To, replace: boolean) => {
      const state = useTabsStore.getState()
      if (state.activeId === id) return false
      const target = typeof to === 'string' ? to : createPath(to)
      const tab = state.tabs.find(item => item.id === id)
      if (tab && (replace || pathOf(target) === pathOf(tab.href))) updateTabs(current => retarget(current, id, target))
      return true
    }
    return {
      ...context,
      navigator: {
        ...navigator,
        push: (to: To, state?: unknown, opts?: Parameters<typeof navigator.push>[2]) => { if (!hidden(to, false)) navigator.push(to, state, opts) },
        replace: (to: To, state?: unknown, opts?: Parameters<typeof navigator.replace>[2]) => { if (!hidden(to, true)) navigator.replace(to, state, opts) },
      },
    }
  }, [context, id])
  return <NavigationContext value={value}>{children}</NavigationContext>
}
