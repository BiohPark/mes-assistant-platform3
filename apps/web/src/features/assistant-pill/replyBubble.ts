import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router'
import { getMessages, getTask } from '@/api/tasks'
import { subscribeEvent } from '@/app/useEvents'
import { useBubbleStore, type BubbleSource } from './bubbles'

const MY_REQUESTS_KEY = 'mes-my-requests'
const MY_REQUESTS_MAX = 100
export const EXCERPT_MAX = 80
/** 서버 request.updated 의 끝 상태 → 말풍선 종류. 그 외(pending·streaming)는 알리지 않는다 */
const TERMINAL: Record<string, BubbleSource> = { succeeded: 'reply.done', failed: 'reply.failed', interrupted: 'reply.failed', cancelled: 'reply.cancelled' }

const readMine = (): string[] => {
  try { const list: unknown = JSON.parse(localStorage.getItem(MY_REQUESTS_KEY) ?? '[]'); return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [] }
  catch { return [] }
}
const writeMine = (list: string[]) => { try { localStorage.setItem(MY_REQUESTS_KEY, JSON.stringify(list.slice(-MY_REQUESTS_MAX))) } catch { /* 저장소 불가 — 알림 없음 */ } }

/** 이 브라우저(모든 탭·팝업이 같은 localStorage)에서 보낸 요청으로 기록 — useChat의 started 에서 부른다 */
export function rememberMyRequest(requestId: string) {
  const list = readMine()
  if (!list.includes(requestId)) writeMine([...list, requestId])
}
/** 기록에 있으면 지우고 true. 같은 요청은 한 번만, 탭이 여러 개면 먼저 읽은 쪽만 알린다(저장소 경합은 허용 범위) */
export function claimMyRequest(requestId: string): boolean {
  const list = readMine()
  if (!list.includes(requestId)) return false
  writeMine(list.filter((id) => id !== requestId))
  return true
}

/** 답의 첫 문장 — 첫 비어 있지 않은 줄에서 마크다운 머리·목록 기호와 강조 기호를 걷고 문장 끝(. ! ? 。)까지, 최대 80자. AI를 부르지 않는다 */
export function firstSentence(text: string, max = EXCERPT_MAX): string {
  const line = text.split('\n').map((item) => item.replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, '').replace(/[*_`]/g, '').trim()).find(Boolean) ?? ''
  const sentence = (/^.*?[.!?。](?=\s|$)/.exec(line)?.[0] ?? line).trim()
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence
}

/**
 * 완료 알림 — 내가 보내 놓은 요청이 끝났는데 그 대화(/c/:id)를 보고 있지 않으면 도우미 말풍선으로 알린다.
 * 서버 SSE(request.updated)를 재사용하고, 제목·답 첫 문장은 TanStack 캐시(['task']·['messages'])에서 읽는다. 팝업 창은 알약을 마운트하지 않으므로 뜨지 않는다
 */
export function useReplyBubble() {
  const query = useQueryClient()
  const { pathname } = useLocation()
  const here = useRef(pathname)
  here.current = pathname
  useEffect(() => subscribeEvent(({ event, data }) => {
    if (event !== 'request.updated') return
    const source = TERMINAL[String(data.status)]
    const { requestId, threadId, taskId } = data
    if (!source || typeof requestId !== 'string' || typeof threadId !== 'string' || typeof taskId !== 'string') return
    if (here.current === `/c/${taskId}`) return // 보고 있는 대화는 화면이 직접 보여 준다 — 기록도 남겨 둔다
    if (!claimMyRequest(requestId)) return
    void (async () => {
      const task = await query.fetchQuery({ queryKey: ['task', taskId], queryFn: () => getTask(taskId) })
      let excerpt: string | undefined
      if (source === 'reply.done') {
        const messages = await query.fetchQuery({ queryKey: ['messages', threadId], queryFn: ({ signal }) => getMessages(threadId, signal) })
        excerpt = firstSentence(messages.find((item) => item.requestId === requestId && item.role === 'assistant')?.content ?? '') || undefined
      }
      useBubbleStore.getState().push({ source, taskId, title: task.title, ...(excerpt && { excerpt }) })
    })().catch(() => undefined) // 대화를 못 읽으면(삭제·권한) 조용히 넘어간다
  }), [query])
}
