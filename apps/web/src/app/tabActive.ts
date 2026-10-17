import { createContext, use } from 'react'

/** 이 화면이 지금 보이는 탭인지. 탭 줄이 없는 곳(모바일·팝업·테스트)은 늘 true */
export const TabActiveContext = createContext(true)

/** 숨은 탭에서는 단축키·말풍선 같은 전역 동작을 멈추는 데 쓴다 */
export const useTabActive = () => use(TabActiveContext)
