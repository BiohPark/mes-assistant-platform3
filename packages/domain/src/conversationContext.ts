import { tagKey } from './tags.js'
import type { Assistant, ContextSnapshot, ID, Message, Task } from './types.js'

/**
 * 대화를 AI 입력으로 고르는 규칙 (docs/fusion-design.md §5).
 * - 후보: 같은 태그를 **직접** 공유하는 다른 대화만. 간접 연결·단계·에이전트 순서는 조건이 아니다.
 * - 전달 대상: 완료된 사용자·assistant 발화만 (팀 의견·system·실패·응답 중 제외).
 */

export interface ConversationCandidate {
  task: Task
  assistant?: Assistant
  /** 후보가 되게 한 공통 태그 (후보 쪽 표기) */
  viaTags: string[]
}

/** 같은 태그를 직접 공유하는 다른 대화. 최근 활동순 — 에이전트 순서로 정렬하지 않는다(선후 관계로 읽히지 않게). */
export function conversationCandidates(me: Task, tasks: Task[], assistants: Assistant[]): ConversationCandidate[] {
  const mine = new Set(me.tags.map(tagKey))
  const byId = new Map(assistants.map((a) => [a.id, a]))
  return tasks
    .filter((t) => t.id !== me.id)
    .map((t) => ({ task: t, assistant: byId.get(t.assistantId), viaTags: t.tags.filter((tag) => mine.has(tagKey(tag))) }))
    .filter((c) => c.viaTags.length > 0)
    .sort((a, b) => b.task.lastActivityAt.localeCompare(a.task.lastActivityAt))
}

/** 참조로 보낼 수 있는 메시지 (시간순 입력을 그대로 유지) */
export function eligibleMessages(messages: Message[]): Message[] {
  return messages.filter(
    (m) => m.status === 'done' && m.kind !== 'discussion' && (m.role === 'user' || m.role === 'assistant') && m.content.trim() !== '',
  )
}

const byTime = (a: Message, b: Message) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)

/** 스냅샷이 가리키는 메시지를 시간순으로. 사라진 ID는 건너뛴다. */
export function snapshotMessages(messageIds: ID[], messages: Message[]): Message[] {
  const wanted = new Set(messageIds)
  return messages.filter((m) => wanted.has(m.id)).sort(byTime)
}

/** 스냅샷 경계 이후에 생긴 적격 메시지 수 ("새 메시지 N · 갱신" 안내용) */
export function newMessagesSince(snapshot: Pick<ContextSnapshot, 'upToMessageId' | 'upToCreatedAt'>, messages: Message[]): number {
  const eligible = eligibleMessages([...messages].sort(byTime))
  if (!snapshot.upToCreatedAt) return eligible.length
  const idx = snapshot.upToMessageId ? eligible.findIndex((m) => m.id === snapshot.upToMessageId) : -1
  if (idx >= 0) return eligible.length - idx - 1
  return eligible.filter((m) => m.createdAt > snapshot.upToCreatedAt!).length
}
