import type { ChatProvider } from './provider.js'
import { cleanTitle } from '@mes/domain'

const REFINE_TIMEOUT_MS = 20_000
const TITLE_MAX = 60
const REFINE_PROMPT =
  '다음 서비스 요청의 제목과 본문을 뜻을 바꾸지 않고 더 명확하고 간결하게 다듬어라. 내용을 추가하거나 추측하지 마라. 첫 줄은 "제목: …" 한 줄, 둘째 줄부터 본문(markdown)만 출력하라.'

export interface SrDraftText { title: string; body: string }

/** 규칙 기반 다듬기 — mock·실패·빈 응답 폴백. 공백·빈 줄만 정리하고 내용은 바꾸지 않는다. */
export function ruleRefine({ title, body }: SrDraftText): SrDraftText {
  return {
    title: title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX),
    body: body.split('\n').map((line) => line.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  }
}

/**
 * SR 제목·본문 다듬기 **제안**. 저장하지 않으며 적용은 사람이 한다.
 * 채팅 응답과 별개의 보조 요청이고, 결과는 제목 한 줄 + 본문으로 나눈다.
 */
export async function refineSrDraft(provider: ChatProvider, model: string, draft: SrDraftText, signal?: AbortSignal): Promise<SrDraftText> {
  const fallback = ruleRefine(draft)
  if (provider.kind === 'mock') return fallback
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(() => controller.abort(), REFINE_TIMEOUT_MS)
  try {
    let acc = ''
    for await (const chunk of provider.stream({
      model,
      messages: [
        { role: 'system', content: REFINE_PROMPT },
        { role: 'user', content: `제목: ${draft.title}\n${draft.body}` },
      ],
      signal: controller.signal,
    })) {
      if (chunk.type === 'delta') acc += chunk.text
      if (chunk.type === 'error') return fallback
    }
    if (signal?.aborted) throw new Error('보조 요청 중지')
    const match = /^\s*(?:제목|title)\s*[:：]\s*(.+)$/im.exec(acc)
    const title = cleanTitle(match?.[1] ?? '').slice(0, TITLE_MAX)
    const body = (match ? acc.replace(match[0], '') : acc).trim()
    return { title: title || fallback.title, body: body || fallback.body }
  } catch {
    if (signal?.aborted) throw new Error('보조 요청 중지')
    return fallback
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
