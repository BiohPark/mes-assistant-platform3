import type { ChatChunk, ChatProvider, ChatRequest } from './provider.js'
import { extractDelta, parseSseLines, type ToolCallFragment } from './sse.js'
import type { LlmSettings } from '@mes/domain'

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function errorMessage(e: unknown): string {
  if (e instanceof DOMException && e.name === 'AbortError') return '요청이 취소되었습니다.'
  if (e instanceof TypeError) return `네트워크 오류 또는 CORS 차단: ${e.message}`
  if (e instanceof Error) return e.message
  return '알 수 없는 오류'
}

/** OpenAI-compatible /chat/completions 스트리밍 클라이언트 (OpenWebUI 포함) */
export class OpenAICompatibleProvider implements ChatProvider {
  readonly kind = 'live' as const
  private readonly settings: LlmSettings

  constructor(settings: LlmSettings) {
    this.settings = settings
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.settings.apiKey) h.Authorization = `Bearer ${this.settings.apiKey}`
    return h
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await fetch(joinUrl(this.settings.baseUrl, 'models'), { headers: this.headers() })
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status} ${res.statusText}` }
      const body = (await res.json()) as { data?: Array<{ id: string }> }
      const ids = body.data?.map((m) => m.id) ?? []
      return { ok: true, detail: ids.length ? `모델 ${ids.length}개 확인 (${ids.slice(0, 3).join(', ')}…)` : '연결 성공' }
    } catch (e) {
      return { ok: false, detail: errorMessage(e) }
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(joinUrl(this.settings.baseUrl, 'models'), { headers: this.headers() })
      if (!res.ok) return []
      const body = (await res.json()) as { data?: Array<{ id: string }> }
      return (body.data ?? []).map((m) => m.id)
    } catch {
      return []
    }
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatChunk> {
    let res: Response
    try {
      res = await fetch(joinUrl(this.settings.baseUrl, 'chat/completions'), {
        method: 'POST',
        headers: this.headers(),
        signal: req.signal,
        body: JSON.stringify({
          model: req.model || this.settings.model,
          messages: req.messages,
          tools: req.tools,
          ...(req.files?.length ? { files: req.files } : {}),
          stream: true,
        }),
      })
    } catch (e) {
      yield { type: 'error', message: errorMessage(e) }
      return
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      yield { type: 'error', message: `HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}` }
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const toolAcc = new Map<number, ToolCallFragment>()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = parseSseLines(buffer)
        buffer = rest
        for (const ev of events) {
          if (ev === '[DONE]') continue
          let parsed: unknown
          try {
            parsed = JSON.parse(ev)
          } catch {
            continue
          }
          const { text, toolCalls } = extractDelta(parsed)
          if (text) yield { type: 'delta', text }
          for (const tc of toolCalls) {
            const prev = toolAcc.get(tc.index)
            toolAcc.set(tc.index, {
              index: tc.index,
              id: tc.id ?? prev?.id,
              name: tc.name ?? prev?.name,
              arguments: (prev?.arguments ?? '') + tc.arguments,
            })
          }
        }
      }
      for (const tc of toolAcc.values()) {
        if (tc.name) yield { type: 'tool_call', call: { id: tc.id ?? `call_${tc.index}`, name: tc.name, arguments: tc.arguments } }
      }
      yield { type: 'done' }
    } catch (e) {
      yield { type: 'error', message: errorMessage(e) }
    }
  }
}
