import { create } from 'zustand'
import type { TranslationKey } from '@/i18n'
import type { Bubble } from './bubbles'
import type { PageRoute } from './pageActions'

/** 도우미 창 '대화' 탭의 한 줄 — 화면 인사, 가이드 요청·대답(문구 키 — 언어를 바꿔도 따라간다), 도우미와 직접 나눈 대화 */
export type LogEntry =
  | { id: string; kind: 'greet'; route: PageRoute }
  | { id: string; kind: 'line'; who: 'user' | 'helper'; text: Extract<TranslationKey, `pill.log.${string}`> }
  | { id: string; kind: 'chat'; role: 'user' | 'assistant'; content: string }
/** '알림 이력' 탭의 한 줄 — 말풍선으로 실제로 보인 것만. 클릭 동작(onOpen)은 남기지 않는다 */
export type Notice = { id: string; at: number } & Pick<Bubble, 'source' | 'title' | 'excerpt' | 'taskId' | 'counts'>

interface Snapshot { userId: string; log: readonly LogEntry[]; notices: readonly Notice[]; greeted: readonly PageRoute[] }

export const HISTORY_KEY = 'assistant-history:v1'
const MAX_LOG = 60
const MAX_NOTICES = 50
const EMPTY: Snapshot = { userId: '', log: [], notices: [], greeted: [] }
let nextId = 1
const id = () => `${Date.now().toString(36)}-${nextId++}`

function read(): Snapshot {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? 'null') as Partial<Snapshot> | null
    if (!parsed || typeof parsed.userId !== 'string') return EMPTY
    return { userId: parsed.userId, log: Array.isArray(parsed.log) ? parsed.log : [], notices: Array.isArray(parsed.notices) ? parsed.notices : [], greeted: Array.isArray(parsed.greeted) ? parsed.greeted : [] }
  } catch { return EMPTY }
}

/**
 * 도우미 이력(S14-HH) — 가이드 대화·말풍선 알림·도우미와 직접 나눈 대화. 사용자 요구대로 그 접속(탭) 동안만: sessionStorage에 두고, 탭을 닫으면 사라진다.
 * 저장이 막혀도 이번 화면에서는 메모리로 쌓인다. 다른 사용자가 같은 탭에 들어오면 비운다. AI를 호출하지 않는다
 */
export const useAssistantHistory = create<Snapshot>()(() => read())
useAssistantHistory.subscribe((state) => {
  try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify({ userId: state.userId, log: state.log, notices: state.notices, greeted: state.greeted })) } catch { /* 메모리에는 남아 있다 */ }
})

/** 페이지 로드 때 저장본을 다시 읽는다(테스트·모듈 초기화) */
export function restoreHistory() { useAssistantHistory.setState(read()) }

/** 지금 사용자 — 저장본이 다른 사용자 것이면 비운다. 아직 아무도 없으면 그동안 쌓인 줄은 이 사용자 것 */
export function bindHistory(userId: string) {
  const current = useAssistantHistory.getState().userId
  if (current === userId) return
  useAssistantHistory.setState(current ? { ...EMPTY, userId } : { userId })
}

const append = <T,>(list: readonly T[], item: T, max: number) => [...list, item].slice(-max)

export function say(who: 'user' | 'helper', text: Extract<LogEntry, { kind: 'line' }>['text']) {
  useAssistantHistory.setState((state) => ({ log: append(state.log, { id: id(), kind: 'line', who, text }, MAX_LOG) }))
}

/** 화면 인사 — 페이지마다 세션에 한 번(대화를 지워도 다시 하지 않는다) */
export function greet(route: PageRoute) {
  useAssistantHistory.setState((state) => state.greeted.includes(route) ? {} : { greeted: [...state.greeted, route], log: append(state.log, { id: id(), kind: 'greet', route }, MAX_LOG) })
}

/** 도우미 대화 훅의 메시지를 비춘다 — 기다리는 중인 답은 끝난 뒤에, 같은 id는 내용만 바꾼다 */
export function mirrorChat(messages: readonly { id: string; role: 'user' | 'assistant'; content: string; waiting?: boolean }[]) {
  useAssistantHistory.setState((state) => {
    let log = state.log
    for (const message of messages) {
      if (message.waiting) continue
      const index = log.findIndex((entry) => entry.kind === 'chat' && entry.id === message.id)
      const entry: LogEntry = { id: message.id, kind: 'chat', role: message.role, content: message.content }
      if (index < 0) log = append(log, entry, MAX_LOG)
      else if ((log[index] as Extract<LogEntry, { kind: 'chat' }>).content !== message.content) log = log.map((item, at) => at === index ? entry : item)
    }
    return log === state.log ? {} : { log }
  })
}

/** '대화 지우기' — 대화 탭만 비운다. 알림 이력과 인사 기록은 둔다 */
export function clearConversation() { useAssistantHistory.setState({ log: [] }) }

/** 말풍선이 실제로 보였을 때 — key는 이 로드의 말풍선 하나(StrictMode 재실행에도 한 번) */
export function recordNotice({ key, ...bubble }: { key: string } & Omit<Notice, 'id' | 'at'>) {
  useAssistantHistory.setState((state) => state.notices.some((notice) => notice.id === key) ? {} : { notices: append(state.notices, { ...bubble, id: key, at: Date.now() }, MAX_NOTICES) })
}

/** 테스트용 초기화 */
export function resetHistory() {
  useAssistantHistory.setState(EMPTY)
  try { sessionStorage.removeItem(HISTORY_KEY) } catch { /* 없음 */ }
}
