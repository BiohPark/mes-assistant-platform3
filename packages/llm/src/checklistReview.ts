import type { ChatChunk, ChatProvider } from './provider.js'
import { checklistReviewPrompt, parseChecklistReview, ruleChecklistReview } from '@mes/domain'
import type { ChecklistItem, ChecklistReview, ChecklistReviewItem, ID, Message } from '@mes/domain'

export interface ChecklistReviewTimeouts {
  firstTokenMs: number
  idleMs: number
}

/**
 * AI 달성도 점검. 채팅 스레드와 별개의 요청이며 결과는 참고 점수(m/n)일 뿐 체크 상태를 바꾸지 않는다.
 * Mock이거나 응답을 해석하지 못하면 규칙 기반 판단으로 대신한다.
 */
export async function reviewChecklist(provider: ChatProvider, model: string, checklist: ChecklistItem[], history: Message[], by: ID, signal?: AbortSignal, onItem?: (item: ChecklistReviewItem) => void, timeouts?: ChecklistReviewTimeouts): Promise<ChecklistReview> {
  if (signal?.aborted) throw new Error('보조 요청 중지')
  const meta = { by, at: new Date().toISOString() }
  const dialog = history.filter((m) => m.status === 'done' && m.kind !== 'discussion' && (m.role === 'user' || m.role === 'assistant'))
  const fallback = () => ruleChecklistReview(checklist, dialog.filter((m) => m.role === 'assistant').map((m) => m.content), meta)
  if (provider.kind === 'mock' || checklist.length === 0) return fallback()

  const transcript = dialog.map((m) => `${m.role === 'user' ? '사용자' : 'AI'}: ${m.content}`).join('\n\n')
  const controller = new AbortController()
  let stop!: () => void
  const stopped = new Promise<never>((_resolve, reject) => {
    stop = () => reject(new Error('보조 요청 중지'))
    controller.signal.addEventListener('abort', stop, { once: true })
  })
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), ms)
  }
  let iterator: AsyncIterator<ChatChunk> | undefined
  try {
    if (timeouts) arm(timeouts.firstTokenMs)
    let acc = ''
    // JSON 문자열 안의 괄호·이스케이프를 존중하며 완성된 항목만 미리 보여 준다.
    // 최종 파싱·규칙 폴백·저장은 기존 경로에서 확정한다.
    const starts: number[] = []
    let quoted = false
    let escaped = false
    const append = (text: string) => {
      const offset = acc.length
      acc += text
      if (!onItem) return
      for (let i = offset; i < acc.length; i++) {
        const char = acc[i]
        if (quoted) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') quoted = false
          continue
        }
        if (char === '"') quoted = true
        else if (char === '{') starts.push(i)
        else if (char === '}') {
          const start = starts.pop()
          if (start === undefined) continue
          const raw = acc.slice(start, i + 1)
          try {
            const entry = JSON.parse(raw) as { no?: unknown }
            const no = Number(entry.no)
            if (!Number.isInteger(no) || no < 1 || no > checklist.length) continue
            const parsed = parseChecklistReview(`[${raw}]`, checklist, meta)
            if (parsed) onItem(parsed.items[no - 1]!)
          } catch { /* 미완성·잘못된 항목은 최종 파싱에서 처리한다 */ }
        }
      }
    }
    iterator = provider.stream({
      model,
      messages: [
        { role: 'system', content: checklistReviewPrompt(checklist) },
        { role: 'user', content: transcript || '(대화 없음)' },
      ],
      signal: controller.signal,
    })[Symbol.asyncIterator]()
    for (;;) {
      const next = await Promise.race([iterator.next(), stopped])
      if (controller.signal.aborted) throw new Error('보조 요청 중지')
      if (next.done) break
      const chunk = next.value
      if (timeouts) arm(timeouts.idleMs)
      if (chunk.type === 'delta') append(chunk.text)
      if (chunk.type === 'error') return fallback()
    }
    return parseChecklistReview(acc, checklist, meta) ?? fallback()
  } catch {
    if (signal?.aborted) throw new Error('보조 요청 중지')
    return fallback()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', stop)
    // 중단을 무시하는 provider의 종료를 기다리느라 폴백·취소가 막히지 않게 한다.
    controller.abort()
    void iterator?.return?.().catch(() => undefined)
  }
}
