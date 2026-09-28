import { eligibleMessages } from '@mes/domain'
import { requestBytes } from '@mes/domain'
import type { Message } from '@mes/domain'
import type { UserMap } from './context.js'
import type { ChatMessageInput, ChatProvider } from './provider.js'

/**
 * 참조 대화 요약 — 사용자가 "요약 만들기"를 누를 때만 실행하는 보조 요청(제목 생성과 같은 부류).
 * 결과는 사람이 확인·수정한 뒤에만 입력으로 적용된다. 자동 분할 요약·자동 절단은 하지 않는다.
 */

export const SUMMARY_PROMPT =
  '다음은 다른 업무 대화의 기록이다. 다른 대화에서 참고 자료로 쓸 수 있도록 한국어로 요약하라. 결정 사항, 수치·ID·기한, 남은 질문을 빠짐없이 목록으로 남기고, 기록에 없는 내용은 만들지 마라.'

export interface SummaryResult {
  text: string
  source: 'ai' | 'rule'
  model?: string
}

export class SummaryBudgetError extends Error {
  constructor(bytes: number, limit: number) {
    super(`요약할 원문이 요청 크기 한도를 넘습니다 (${Math.ceil(bytes / 1024)} KB / ${Math.ceil(limit / 1024)} KB). 메시지 범위를 줄인 뒤 다시 요약하세요.`)
  }
}

function transcript(messages: Message[], users: UserMap): string {
  return eligibleMessages(messages)
    .map((m) => {
      const who = m.role === 'user' ? `사용자${m.authorId && users.get(m.authorId) ? ` · ${users.get(m.authorId)!.name}` : ''}` : 'assistant'
      return `[${who}] ${m.content}`
    })
    .join('\n\n')
}

/** Mock 대역: 각 답변의 첫 줄을 모은다 (실제 요약이 아님을 밝힌다) */
function ruleSummary(messages: Message[]): string {
  const lines = eligibleMessages(messages)
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content.split('\n').find((l) => l.trim())?.trim())
    .filter((l): l is string => !!l)
  return ['(Mock 대역 요약 — 각 답변의 첫 줄을 모은 것으로 실제 요약이 아닙니다)', ...lines.map((l) => `- ${l}`)].join('\n')
}

export interface SummaryOptions {
  limitBytes: number
  signal?: AbortSignal
}

export async function summarizeConversation(provider: ChatProvider, model: string, messages: Message[], users: UserMap, opts: SummaryOptions): Promise<SummaryResult> {
  if (provider.kind === 'mock') return { text: ruleSummary(messages), source: 'rule' }
  const request: ChatMessageInput[] = [
    { role: 'system', content: SUMMARY_PROMPT },
    { role: 'user', content: transcript(messages, users) },
  ]
  const bytes = requestBytes({ model, messages: request })
  if (bytes > opts.limitBytes) throw new SummaryBudgetError(bytes, opts.limitBytes)
  let acc = ''
  for await (const chunk of provider.stream({ model, messages: request, signal: opts.signal })) {
    if (chunk.type === 'delta') acc += chunk.text
    if (chunk.type === 'error') throw new Error(chunk.message)
  }
  if (!acc.trim()) throw new Error('요약 응답이 비어 있습니다.')
  return { text: acc.trim(), source: 'ai', model }
}
