import type { ChatProvider } from './provider.js'
import { cleanTitle, ruleTitle } from '@mes/domain'
import type { Message } from '@mes/domain'

const TITLE_TIMEOUT_MS = 10_000
const TRANSCRIPT_CHARS = 600

const TITLE_PROMPT =
  '다음 대화의 제목을 한국어 명사구 하나로 25자 이내로 만들어라. 제목만 출력하고 따옴표·설명·마침표를 붙이지 마라.'

/**
 * 대화 제목 제안. 채팅 응답과 별개의 요청으로 만든다.
 * mock이거나 실패·빈 응답이면 규칙 기반 제목, 그것도 없으면 undefined.
 */
export async function suggestTitle(provider: ChatProvider, model: string, history: Message[], signal?: AbortSignal): Promise<string | undefined> {
  const dialog = history.filter((m) => m.status === 'done' && m.kind !== 'discussion' && (m.role === 'user' || m.role === 'assistant'))
  const fallback = ruleTitle(dialog.filter((m) => m.role === 'user').map((m) => m.content))
  if (provider.kind === 'mock') return fallback
  const transcript = dialog
    .slice(0, 4)
    .map((m) => `${m.role === 'user' ? '사용자' : 'AI'}: ${m.content.slice(0, TRANSCRIPT_CHARS)}`)
    .join('\n')
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS)
  try {
    let acc = ''
    for await (const chunk of provider.stream({
      model,
      messages: [
        { role: 'system', content: TITLE_PROMPT },
        { role: 'user', content: transcript },
      ],
      signal: controller.signal,
    })) {
      if (chunk.type === 'delta') acc += chunk.text
      if (chunk.type === 'error') return fallback
    }
    if (signal?.aborted) throw new Error('보조 요청 중지')
    return cleanTitle(acc) || fallback
  } catch {
    if (signal?.aborted) throw new Error('보조 요청 중지')
    return fallback
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
