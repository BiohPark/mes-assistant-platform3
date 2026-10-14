import { eligibleMessages, requestBytes } from '@mes/domain'
import type { Message } from '@mes/domain'
import type { ChatMessageInput, ChatProvider } from './provider.js'

/**
 * 대화 요약 카드 — 대화에 들어갈 때 위쪽에 보이는 표시 전용 보조 요청(추천 첫 질문과 같은 부류).
 * 결과는 화면에만 쓴다. 요청 조립·트레이·참조 요약에는 넣지 않는다. 자동 절단·자동 분할은 하지 않는다.
 */

export const CHAT_BRIEF_PROMPT =
  '다음은 한 업무 대화의 기록이다. 화면 위쪽 요약 카드에 넣을 두 줄을 한국어로 만들어라. 첫 줄은 "주제: "로 시작해 이 대화가 무엇에 관한 것인지 한 문장으로, 둘째 줄은 "다음: "로 시작해 기록에 비추어 사용자가 다음에 해 볼 만한 일을 한 문장으로 제안하라. 두 줄만 출력하고 기록에 없는 내용은 만들지 마라.'

export interface ChatBriefText {
  about: string
  next: string
  source: 'ai' | 'rule'
  model?: string
}

export class ChatBriefBudgetError extends Error {
  constructor(bytes: number, limit: number) {
    super(`요약 카드 원문이 요청 크기 한도를 넘습니다 (${Math.ceil(bytes / 1024)} KB / ${Math.ceil(limit / 1024)} KB)`)
  }
}

const clean = (line: string) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim()
const LABEL = /^(주제|다음)\s*[:：]\s*/

/** 모델 응답을 두 줄로 — "주제:"·"다음:" 표시가 있으면 그것을, 없으면 앞의 두 줄을 쓴다. 못 읽으면 undefined */
export function parseChatBrief(text: string): { about: string; next: string } | undefined {
  const lines = text.split('\n').map(clean).filter(Boolean)
  const labelled = lines.filter((line) => LABEL.test(line))
  if (labelled.length) {
    const pick = (label: string) => labelled.find((line) => line.startsWith(label))?.replace(LABEL, '').trim()
    const about = pick('주제'), next = pick('다음')
    return about && next ? { about, next } : undefined
  }
  return lines.length >= 2 ? { about: lines[0]!, next: lines[1]! } : undefined
}

function transcript(messages: Message[]): string {
  return eligibleMessages(messages).map((m) => `[${m.role === 'user' ? '사용자' : 'assistant'}] ${m.content}`).join('\n\n')
}

/** Mock 대역: 첫 질문의 첫 줄과 고정 안내(실제 요약이 아님을 밝힌다) — E2E가 기대할 수 있게 결정적이다 */
function ruleBrief(messages: Message[]): ChatBriefText {
  const first = eligibleMessages(messages).find((m) => m.role === 'user')?.content.split('\n').find((line) => line.trim())?.trim() ?? ''
  return { about: `(Mock 대역) ${first}`, next: '(Mock 대역) 마지막 답변을 확인하고 이어서 질문하세요', source: 'rule' }
}

export interface ChatBriefOptions {
  limitBytes: number
  signal?: AbortSignal
}

/** 실패(모델 오류·못 읽는 응답·한도 초과·중지)는 던진다 — 호출자는 저장하지 않고 나중에 다시 시도한다 */
export async function draftChatBrief(provider: ChatProvider, model: string, messages: Message[], opts: ChatBriefOptions): Promise<ChatBriefText> {
  if (provider.kind === 'mock') return ruleBrief(messages)
  const request: ChatMessageInput[] = [
    { role: 'system', content: CHAT_BRIEF_PROMPT },
    { role: 'user', content: transcript(messages) },
  ]
  const bytes = requestBytes({ model, messages: request })
  if (bytes > opts.limitBytes) throw new ChatBriefBudgetError(bytes, opts.limitBytes)
  try {
    let acc = ''
    for await (const chunk of provider.stream({ model, messages: request, signal: opts.signal })) {
      if (chunk.type === 'delta') acc += chunk.text
      if (chunk.type === 'error') throw new Error(chunk.message)
    }
    if (opts.signal?.aborted) throw new Error('보조 요청 중지')
    const parsed = parseChatBrief(acc)
    if (!parsed) throw new Error('요약 카드 응답을 읽지 못했습니다')
    return { ...parsed, source: 'ai', model }
  } catch (error) {
    if (opts.signal?.aborted) throw new Error('보조 요청 중지')
    throw error
  }
}
