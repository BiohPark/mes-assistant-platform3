import { createContext, use, useCallback, useEffect, useRef } from 'react'

/** 이 화면이 지금 보이는 탭인지. 탭 줄이 없는 곳(모바일·팝업·테스트)은 늘 true */
export const TabActiveContext = createContext(true)

/** 숨은 탭에서는 단축키·말풍선 같은 전역 동작을 멈추는 데 쓴다 */
export const useTabActive = () => use(TabActiveContext)

/**
 * 이 화면의 알림(토스트)을 화면이 보일 때 띄운다 — 숨은 탭의 늦게 끝난 요청이 보고 있는 다른 탭 위에 이 대화의 알림·되돌리기 버튼을 띄우지 않게(S15).
 * 숨어 있는 동안 생긴 알림은 다시 보일 때 차례로 띄우고, 그 전에 화면이 내려가면 버린다
 */
export function useWhenVisible() {
  const active = useTabActive()
  const visible = useRef(active)
  const queued = useRef<Array<() => void>>([])
  useEffect(() => {
    visible.current = active
    if (active) for (const show of queued.current.splice(0)) show()
  }, [active])
  return useCallback((show: () => void) => { if (visible.current) show(); else queued.current.push(show) }, [])
}
