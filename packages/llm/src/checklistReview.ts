import type { ChatProvider } from './provider.js'
import { checklistReviewPrompt, parseChecklistReview, ruleChecklistReview } from '@mes/domain'
import type { ChecklistItem, ChecklistReview, ID, Message } from '@mes/domain'

const REVIEW_TIMEOUT_MS = 30_000

/**
 * AI 달성도 점검. 채팅 스레드와 별개의 요청이며 결과는 참고 점수(m/n)일 뿐 체크 상태를 바꾸지 않는다.
 * Mock이거나 응답을 해석하지 못하면 규칙 기반 판단으로 대신한다.
 */
export async function reviewChecklist(provider: ChatProvider, model: string, checklist: ChecklistItem[], history: Message[], by: ID, signal?: AbortSignal): Promise<ChecklistReview> {
  const meta = { by, at: new Date().toISOString() }
  const dialog = history.filter((m) => m.status === 'done' && m.kind !== 'discussion' && (m.role === 'user' || m.role === 'assistant'))
  const fallback = () => ruleChecklistReview(checklist, dialog.filter((m) => m.role === 'assistant').map((m) => m.content), meta)
  if (provider.kind === 'mock' || checklist.length === 0) return fallback()

  const transcript = dialog.map((m) => `${m.role === 'user' ? '사용자' : 'AI'}: ${m.content}`).join('\n\n')
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS)
  try {
    let acc = ''
    for await (const chunk of provider.stream({
      model,
      messages: [
        { role: 'system', content: checklistReviewPrompt(checklist) },
        { role: 'user', content: transcript || '(대화 없음)' },
      ],
      signal: controller.signal,
    })) {
      if (chunk.type === 'delta') acc += chunk.text
      if (chunk.type === 'error') return fallback()
    }
    return parseChecklistReview(acc, checklist, meta) ?? fallback()
  } catch {
    if (signal?.aborted) throw new Error('보조 요청 중지')
    return fallback()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
