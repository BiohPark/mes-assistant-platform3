import type { ChatChunk, ChatProvider, ChatRequest } from './provider.js'
import { LimitedFetchError, limitedFetch, toLimitedFetchError } from './limitedFetch.js'
import { extractDelta, parseSseLines, ThinkSplitter, type ToolCallFragment } from './sse.js'
import { owuiModelTools } from './owuiProbe.js'
import type { LlmSettings } from '@mes/domain'

/** 모델 목록·ping 상한 — 목록은 모델당 메타데이터가 붙어 수 MB가 될 수 있다 */
const MODELS_TIMEOUT_MS = 15_000
const MODELS_MAX_BYTES = 4 * 1024 * 1024
const FRAME_TOO_LARGE = '응답 프레임 크기 초과'
const TOOL_REQUEST_REJECTED = new Set([400, 404, 405, 415, 422])

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
  private modelMeta?: { body: unknown; expires: number }

  private async modelTools(model: string, signal?: AbortSignal) {
    if (!this.modelMeta || this.modelMeta.expires <= Date.now()) {
      const res = await limitedFetch(joinUrl(this.settings.baseUrl, 'models'), { headers: this.headers() },
        { timeoutMs: MODELS_TIMEOUT_MS, maxResponseBytes: MODELS_MAX_BYTES, signal })
      if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw new Error('모델 메타 조회 실패') }
      const body: unknown = await res.json()
      parseModelIds(body)
      this.modelMeta = { body, expires: Date.now() + 5 * 60_000 }
    }
    return owuiModelTools(this.modelMeta.body, model, this.settings.apiKey)
  }

  constructor(settings: LlmSettings, private readonly readOwuiTools?: () => Promise<'auto' | 'off'>) {
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
    // 프레임·응답 상한은 limits를 준 호출(시험)에만 — 일반 채팅은 OpenWebUI RAG `sources`처럼 큰 프레임을 받을 수 있다
    const limits = req.limits ?? {}
    const maxFrameBytes = limits.maxFrameBytes ?? Number.POSITIVE_INFINITY
    const basic: Record<string, unknown> = { model: req.model || this.settings.model, messages: req.messages,
      ...(req.tools?.length ? { tools: req.tools } : {}), ...(req.files?.length ? { files: req.files } : {}), stream: true }
    let extras: ReturnType<typeof owuiModelTools> | undefined
    if (this.settings.preset === 'openwebui' && !req.tools?.length) {
      try {
        const mode = req.owuiTools ?? (this.readOwuiTools ? await this.readOwuiTools() : this.settings.owuiTools ?? 'auto')
        const meta = mode === 'auto' ? await this.modelTools(String(basic.model), req.signal) : undefined
        if (meta && (meta.tool_ids.length || Object.keys(meta.features).length)) extras = meta
      } catch { /* 메타·설정 조회 실패는 기본 전송으로 진행한다. */ }
    }
    for (let attempt = 0; attempt < (extras ? 2 : 1); attempt++) {
      const enhanced = !!extras && attempt === 0
      const body = enhanced ? { ...basic, ...extras, params: { function_calling: 'legacy' } } : basic
      const delivery = enhanced ? { mode: 'tools' as const, ...extras } : { mode: attempt ? 'fallback' as const : 'basic' as const }
      if (req.signal?.aborted) { yield { type: 'error', message: '요청이 취소되었습니다.' }; return }
      await req.onDispatch?.(delivery, body)
      let res: Response | undefined
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      try {
        res = await limitedFetch(joinUrl(this.settings.baseUrl, 'chat/completions'), {
          method: 'POST', headers: this.headers(), body: JSON.stringify(body),
        }, { timeoutMs: limits.timeoutMs, maxResponseBytes: limits.maxResponseBytes, signal: req.signal })
        if (!res.ok || !res.body) {
          await res.body?.cancel().catch(() => undefined)
          if (enhanced && TOOL_REQUEST_REJECTED.has(res.status) && !req.signal?.aborted) continue
          yield { type: 'error', message: `LLM 서비스 오류 (HTTP ${res.status})` }
          return
        }
        reader = res.body.getReader()
        const decoder = new TextDecoder()
        const encoder = new TextEncoder()
        let buffer = ''
        const think = new ThinkSplitter()
        const toolAcc = new Map<number, ToolCallFragment>()
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const { events, rest } = parseSseLines(buffer)
          buffer = rest
          for (const ev of events) {
            if (ev === '[DONE]') continue
            if (Number.isFinite(maxFrameBytes) && encoder.encode(ev).byteLength > maxFrameBytes) {
              await reader.cancel().catch(() => undefined)
              yield { type: 'error', message: FRAME_TOO_LARGE }
              return
            }
            let parsed: unknown
            try {
              parsed = JSON.parse(ev)
            } catch {
              continue
            }
            const { text, reasoning, toolCalls } = extractDelta(parsed)
            if (reasoning) yield { type: 'reasoning', text: reasoning }
            for (const chunk of think.push(text)) yield chunk
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
          if (Number.isFinite(maxFrameBytes) && encoder.encode(buffer).byteLength > maxFrameBytes) {
            await reader.cancel().catch(() => undefined)
            yield { type: 'error', message: FRAME_TOO_LARGE }
            return
          }
        }
        for (const chunk of think.finish()) yield chunk
        for (const tc of toolAcc.values()) {
          if (tc.name) yield { type: 'tool_call', call: { id: tc.id ?? `call_${tc.index}`, name: tc.name, arguments: tc.arguments } }
        }
        yield { type: 'done' }
        return
      } catch (e) {
        // 응답·스트림이 시작되었거나 실행 여부가 불명확하면 자동 재전송하지 않는다.
        if (enhanced && !res && !req.signal?.aborted && toLimitedFetchError(e).requestNotSent) continue
        yield { type: 'error', message: errorMessage(e) }
        return
      } finally {
        await reader?.cancel().catch(() => undefined)
        reader?.releaseLock()
      }
    }
  }
}
