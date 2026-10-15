import type { ChatChunk, ChatMessageInput, ChatProvider } from './provider.js'
import { cleanTitle, draftFromConversation, requestBytes } from '@mes/domain'
import type { Message } from '@mes/domain'

const TITLE_MAX = 60
/** 자동작성 — 접수 대화만 근거로 초안을 쓴다. 대화에 없는 내용은 추측하지 않는다. 업무 절차는 지시하지 않는다. */
export const SR_COMPOSE_PROMPT =
  '다음은 서비스 요청(SR) 접수 대화 기록이다. 이 기록만 근거로 SR 제목과 본문 초안을 한국어로 작성하라. 기록에 없는 내용은 추측하거나 지어내지 마라. 첫 줄은 "제목: …" 한 줄(60자 이내), 둘째 줄부터 본문(markdown)만 출력하라.'
/** 다듬기 — 뜻을 바꾸지 않는다. 대화에는 있으나 본문에 빠진 점은 본문에 넣지 않고 "추천:" 목록으로만 돌려준다. */
export const SR_REFINE_PROMPT =
  '다음 서비스 요청의 제목과 본문을 뜻을 바꾸지 않고 더 명확하고 간결하게 다듬어라. 본문에 내용을 추가하거나 추측하지 마라. 접수 대화 기록은 참고용이다 — 기록에는 있으나 본문에 빠진 점이 있으면 본문에 넣지 말고 맨 끝에 "추천:" 한 줄 뒤에 "- "로 시작하는 줄로 나열하라(없으면 "추천:" 줄을 쓰지 마라). 첫 줄은 "제목: …" 한 줄, 둘째 줄부터 본문(markdown), 그 다음 추천 목록만 출력하라.'

export interface SrDraftText { title: string; body: string }
/** 제안 결과 — source가 rule이면 AI 응답을 못 받아 규칙으로 정리한 것(화면에 표시). suggestions는 본문에 넣지 않은 추천 목록. */
export interface SrProposal extends SrDraftText { suggestions: string[]; source: 'ai' | 'rule'; model?: string }
export interface SrAiTimeouts { firstTokenMs: number; idleMs: number }
export interface SrAiOptions {
  /** 요청 크기 한도 — 넘으면 자르지 않고 SrDraftBudgetError */
  limitBytes: number
  signal?: AbortSignal
  /** 진행 표시용 — 받은 본문 조각 그대로 */
  onDelta?: (text: string) => void
  /** 본 요청과 같은 첫 토큰·무응답 기준. 없으면 제한 없음(테스트) */
  timeouts?: SrAiTimeouts
}

export class SrDraftBudgetError extends Error {
  constructor(bytes: number, limit: number) {
    super(`접수 대화가 요청 크기 한도를 넘습니다 (${Math.ceil(bytes / 1024)} KB / ${Math.ceil(limit / 1024)} KB). 자르지 않고 보내지 않았습니다`)
  }
}

/** 규칙 기반 다듬기 — mock·실패·빈 응답 폴백. 공백·빈 줄만 정리하고 내용은 바꾸지 않는다. */
export function ruleRefine({ title, body }: SrDraftText): SrDraftText {
  return {
    title: title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX),
    body: body.split('\n').map((line) => line.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  }
}

const TITLE_LINE = /^\s*(?:제목|title)\s*[:：]\s*(.+)$/im
const SUGGESTIONS_LINE = /^\s*(?:추천|recommendations?|suggestions?)\s*[:：]\s*$/im
const BULLET = /^(?:[-*•]|\d+[.)])\s*/

/** 모델 응답을 제목 한 줄 + 본문(markdown) + 추천 목록으로 나눈다. 없는 부분은 빈 값. */
export function parseSrProposal(text: string): { title: string; body: string; suggestions: string[] } {
  const match = TITLE_LINE.exec(text)
  const rest = match ? text.replace(match[0], '') : text
  const split = SUGGESTIONS_LINE.exec(rest)
  const body = (split ? rest.slice(0, split.index) : rest).trim()
  const suggestions = split ? rest.slice(split.index + split[0].length).split('\n').map((line) => line.trim().replace(BULLET, '').trim()).filter(Boolean) : []
  return { title: cleanTitle(match?.[1] ?? '').slice(0, TITLE_MAX), body, suggestions }
}

/** 접수 대화 중 AI 요청에 들어갈 메시지 — 완료된 사용자·AI 발화만(접수 본문 메시지 같은 discussion 제외). */
const dialogOf = (history: Message[]) => history.filter((m) => m.status === 'done' && m.kind !== 'discussion' && (m.role === 'user' || m.role === 'assistant'))
const transcriptOf = (dialog: Message[]) => dialog.map((m) => `${m.role === 'user' ? '사용자' : 'AI'}: ${m.content}`).join('\n\n')

/**
 * 보조 스트림을 끝까지 읽어 본문을 돌려준다. 한도 초과는 던지고(자르지 않음), 호출자 중지는 던지며,
 * mock·provider 오류·첫 토큰·무응답 시간 초과는 undefined(규칙 폴백) — 달성도 점검과 같은 규약.
 */
async function collect(provider: ChatProvider, model: string, messages: ChatMessageInput[], opts: SrAiOptions): Promise<string | undefined> {
  const bytes = requestBytes({ model, messages })
  if (bytes > opts.limitBytes) throw new SrDraftBudgetError(bytes, opts.limitBytes)
  if (opts.signal?.aborted) throw new Error('보조 요청 중지')
  if (provider.kind === 'mock') return undefined
  const controller = new AbortController()
  let stop!: () => void
  const stopped = new Promise<never>((_resolve, reject) => {
    stop = () => reject(new Error('보조 요청 중지'))
    controller.signal.addEventListener('abort', stop, { once: true })
  })
  const abort = () => controller.abort()
  opts.signal?.addEventListener('abort', abort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), ms) }
  let iterator: AsyncIterator<ChatChunk> | undefined
  try {
    if (opts.timeouts) arm(opts.timeouts.firstTokenMs)
    let acc = ''
    iterator = provider.stream({ model, messages, signal: controller.signal })[Symbol.asyncIterator]()
    for (;;) {
      const next = await Promise.race([iterator.next(), stopped])
      if (controller.signal.aborted) throw new Error('보조 요청 중지')
      if (next.done) break
      const chunk = next.value
      if (opts.timeouts) arm(opts.timeouts.idleMs)
      if (chunk.type === 'delta') { acc += chunk.text; opts.onDelta?.(chunk.text) }
      if (chunk.type === 'error') return undefined
    }
    return acc
  } catch {
    if (opts.signal?.aborted) throw new Error('보조 요청 중지')
    return undefined
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', stop)
    // 중단을 무시하는 provider의 종료를 기다리느라 폴백·취소가 막히지 않게 한다.
    controller.abort()
    void iterator?.return?.().catch(() => undefined)
  }
}

/**
 * AI 자동작성 **제안** — 접수 대화 전체를 보고 제목·본문 초안을 쓴다. 저장하지 않으며 적용은 사람이 한다.
 * mock·실패·시간 초과면 규칙 초안(draftFromConversation, source: rule).
 */
export async function composeSrDraft(provider: ChatProvider, model: string, history: Message[], opts: SrAiOptions): Promise<SrProposal> {
  const dialog = dialogOf(history)
  const fallback: SrProposal = { ...draftFromConversation(dialog.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))), suggestions: [], source: 'rule' }
  const acc = await collect(provider, model, [{ role: 'system', content: SR_COMPOSE_PROMPT }, { role: 'user', content: transcriptOf(dialog) || '(대화 없음)' }], opts)
  if (!acc?.trim()) return fallback
  const parsed = parseSrProposal(acc)
  return { title: parsed.title || fallback.title, body: parsed.body || fallback.body, suggestions: [], source: 'ai', model }
}

/**
 * AI 다듬기 **제안** — 현재 제목·본문을 뜻을 바꾸지 않고 다듬는다. 대화는 참고만 하고 빠진 점은 suggestions로 따로 돌려준다.
 * mock·실패·시간 초과면 규칙 정리(ruleRefine, source: rule).
 */
export async function refineSrDraft(provider: ChatProvider, model: string, draft: SrDraftText, history: Message[], opts: SrAiOptions): Promise<SrProposal> {
  const fallback: SrProposal = { ...ruleRefine(draft), suggestions: [], source: 'rule' }
  const user = `[접수 대화]\n${transcriptOf(dialogOf(history)) || '(대화 없음)'}\n\n[현재 초안]\n제목: ${draft.title}\n${draft.body}`
  const acc = await collect(provider, model, [{ role: 'system', content: SR_REFINE_PROMPT }, { role: 'user', content: user }], opts)
  if (!acc?.trim()) return fallback
  const parsed = parseSrProposal(acc)
  return { title: parsed.title || fallback.title, body: parsed.body || fallback.body, suggestions: parsed.suggestions, source: 'ai', model }
}
