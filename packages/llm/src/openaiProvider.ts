import type { ChatChunk, ChatProvider, ChatRequest } from './provider.js'
import { LimitedFetchError, limitedFetch, toLimitedFetchError } from './limitedFetch.js'
import { extractDelta, parseSseLines, type ToolCallFragment } from './sse.js'
import type { LlmSettings } from '@mes/domain'

/** 모델 목록·ping 상한 — 목록은 모델당 메타데이터가 붙어 수 MB가 될 수 있다 */
const MODELS_TIMEOUT_MS = 15_000
const MODELS_MAX_BYTES = 4 * 1024 * 1024
/** 채팅 스트림 프레임 기본 상한 — 델타 하나가 이보다 크면 응답이 아니라 오류로 본다 */
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024
const FRAME_TOO_LARGE = '응답 프레임 크기 초과'

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function errorMessage(e: unknown): string {
  return toLimitedFetchError(e).message
}

function parseModelIds(body: unknown): string[] {
  const data = body !== null && typeof body === 'object' ? (body as { data?: unknown }).data : undefined
  if (!Array.isArray(data) || !data.every((m) => m !== null && typeof m === 'object' && typeof m.id === 'string')) throw new Error('응답 형식 오류')
  return data.map((m) => m.id)
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

  private async fetchModelIds(): Promise<string[]> {
    const res = await limitedFetch(joinUrl(this.settings.baseUrl, 'models'), { headers: this.headers() }, { timeoutMs: MODELS_TIMEOUT_MS, maxResponseBytes: MODELS_MAX_BYTES })
    if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw new Error(`HTTP ${res.status}`) }
    return parseModelIds(await res.json())
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    try {
      const ids = await this.fetchModelIds()
      return { ok: true, detail: ids.length ? `모델 ${ids.length}개 확인` : '연결 성공' }
    } catch (e) {
      if (e instanceof Error && (e.message === '응답 형식 오류' || /^HTTP \d+$/.test(e.message))) return { ok: false, detail: e.message }
      return { ok: false, detail: errorMessage(e) }
    }
  }

  async listModels(): Promise<string[]> {
    try {
      return await this.fetchModelIds()
    } catch (error) {
      if (error instanceof Error && /^HTTP \d+$|^응답 형식 오류$/.test(error.message)) throw error
      if (error instanceof LimitedFetchError && error.code !== 'network') throw error
      throw new Error('모델 목록 네트워크 오류')
    }
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatChunk> {
    const limits = req.limits ?? {}
    const maxFrameBytes = limits.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES
    let res: Response
    try {
      res = await limitedFetch(joinUrl(this.settings.baseUrl, 'chat/completions'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: req.model || this.settings.model,
          messages: req.messages,
          tools: req.tools,
          ...(req.files?.length ? { files: req.files } : {}),
          stream: true,
        }),
      }, { timeoutMs: limits.timeoutMs, maxResponseBytes: limits.maxResponseBytes, signal: req.signal })
    } catch (e) {
      yield { type: 'error', message: errorMessage(e) }
      return
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined)
      yield { type: 'error', message: `LLM 서비스 오류 (HTTP ${res.status})` }
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
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
        if (encoder.encode(buffer).byteLength > maxFrameBytes) {
          await reader.cancel().catch(() => undefined)
          yield { type: 'error', message: FRAME_TOO_LARGE }
          return
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
