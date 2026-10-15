import { randomUUID } from 'node:crypto'
import type { ChatChunk, ChatProvider, ChatRequest } from './provider.js'
import { LimitedFetchError, limitedFetch, toLimitedFetchError } from './limitedFetch.js'
import { extractDelta, parseSseLines, ThinkSplitter, type ToolCallFragment } from './sse.js'
import { owuiModelTools, type OwuiDefaults } from './owuiProbe.js'
import type { LlmSettings } from '@mes/domain'

/** 모델 목록·ping 상한 — 목록은 모델당 메타데이터가 붙어 수 MB가 될 수 있다 */
const MODELS_TIMEOUT_MS = 15_000
const MODELS_MAX_BYTES = 4 * 1024 * 1024
const FRAME_TOO_LARGE = '응답 프레임 크기 초과'
const TOOL_REQUEST_REJECTED = new Set([400, 404, 405, 415, 422])
/** 세션 모드(S12) — 채팅 조회 상한·연속 실패 허용·정리 호출 시간 */
const SESSION_POLL_MS = 1_000
const SESSION_POLL_TIMEOUT_MS = 15_000
const SESSION_POLL_MAX_BYTES = 32 * 1024 * 1024
const SESSION_POLL_FAILURES = 5
const SESSION_CLEANUP_TIMEOUT_MS = 10_000
const SESSION_STATUS_MAX = 200
const CANCELLED = '요청이 취소되었습니다.'

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function errorMessage(e: unknown): string {
  return toLimitedFetchError(e).message
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** OpenWebUI output 항목의 텍스트 조각 — content(또는 summary)의 text만 */
function partsText(parts: unknown): string {
  return Array.isArray(parts) ? parts.map((part) => isObject(part) && typeof part.text === 'string' ? part.text : '').join('') : ''
}

/** 채팅 메시지의 누적 본문·생각·최근 상태. 본문은 OpenWebUI get_output_text와 같게(message 항목, 공백뿐인 항목 제외, 줄바꿈 연결) 만든다 */
function readSessionMessage(message: Record<string, unknown>) {
  const output = Array.isArray(message.output) ? message.output.filter(isObject) : []
  const content = output.filter((item) => item.type === 'message').map((item) => partsText(item.content)).filter((text) => text.trim()).join('\n')
  const reasoning = output.filter((item) => item.type === 'reasoning').map((item) => partsText(item.content) || partsText(item.summary)).filter(Boolean).join('\n')
  const history = Array.isArray(message.statusHistory) ? message.statusHistory : []
  // 상태 항목마다 보이는 문구(숨김·빈 문구는 undefined) — 폴링 사이에 지나간 단계도 놓치지 않는다
  const statuses = history.map((item) => isObject(item) && item.hidden !== true && typeof item.description === 'string' && item.description.trim()
    ? item.description.trim().slice(0, SESSION_STATUS_MAX) : undefined)
  return { content: content || (typeof message.content === 'string' ? message.content : ''), reasoning, statuses,
    done: message.done === true, error: message.error !== undefined && message.error !== null && message.error !== false }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return }
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

/** 전달 기록(owuiTools)은 도구·기능만 — 나머지 기본값은 snapshot이 본문에서 남긴다 */
const toolDelivery = ({ tool_ids, features }: OwuiDefaults) => ({ mode: 'tools' as const, ...(tool_ids ? { tool_ids } : {}), ...(features ? { features } : {}) })

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

  private readonly sessionPollMs: number

  constructor(settings: LlmSettings, private readonly readOwuiTools?: () => Promise<'auto' | 'off'>, options: { sessionPollMs?: number } = {}) {
    this.settings = settings
    this.sessionPollMs = options.sessionPollMs ?? SESSION_POLL_MS
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
        if (meta && Object.keys(meta).length) extras = meta
      } catch { /* 메타·설정 조회 실패는 기본 전송으로 진행한다. */ }
    }
    // 세션 모드는 지정한 대화 요청만 — 앱 도구 호출·시험(limits) 호출은 기존 방식을 쓴다
    if (this.settings.preset === 'openwebui' && !req.tools?.length && !req.limits && (req.owuiMode === 'auto' || req.owuiMode === 'session')) {
      if ((yield* this.streamSession(req, basic, extras, req.owuiMode)) === 'handled') return
    }
    for (let attempt = 0; attempt < (extras ? 2 : 1); attempt++) {
      const enhanced = !!extras && attempt === 0
      const body = enhanced ? { ...basic, ...extras, params: { function_calling: 'legacy' } } : basic
      const delivery = enhanced && extras ? toolDelivery(extras) : { mode: attempt ? 'fallback' as const : 'basic' as const }
      if (req.signal?.aborted) { yield { type: 'error', message: CANCELLED }; return }
      await req.onDispatch?.(delivery, body)
      let res: Response
      try {
        res = await limitedFetch(joinUrl(this.settings.baseUrl, 'chat/completions'), {
          method: 'POST', headers: this.headers(), body: JSON.stringify(body),
        }, { timeoutMs: limits.timeoutMs, maxResponseBytes: limits.maxResponseBytes, signal: req.signal })
      } catch (e) {
        // 응답이 시작되었거나 실행 여부가 불명확하면 자동 재전송하지 않는다.
        if (enhanced && !req.signal?.aborted && toLimitedFetchError(e).requestNotSent) continue
        yield { type: 'error', message: errorMessage(e) }
        return
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => undefined)
        if (enhanced && TOOL_REQUEST_REJECTED.has(res.status) && !req.signal?.aborted) continue
        yield { type: 'error', message: `LLM 서비스 오류 (HTTP ${res.status})` }
        return
      }
      yield* this.readSse(res.body, maxFrameBytes)
      return
    }
  }

  /** SSE 응답 본문 → 청크. 끝나면 done, 실패하면 error 하나로 끝낸다. */
  private async *readSse(body: ReadableStream<Uint8Array>, maxFrameBytes: number): AsyncGenerator<ChatChunk> {
    const reader = body.getReader()
    try {
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
    } catch (e) {
      yield { type: 'error', message: errorMessage(e) }
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }

  /**
   * 세션 모드(S12, OpenWebUI v0.12): session_id·id·parent_id:null로 백그라운드 채팅을 만들고 채팅 GET을 폴링한다.
   * user_message를 보내지 않아 OpenWebUI가 우리가 조립한 messages를 그대로 쓴다(보낸 것=본 것).
   * 'fallback' = 실행되지 않았음이 확실한 생성 거부(4xx)·형식 불일치(auto만) — 호출부가 기존 방식으로 한 번 보낸다.
   */
  private async *streamSession(req: ChatRequest, basic: Record<string, unknown>, extras: ReturnType<typeof owuiModelTools> | undefined,
    mode: 'auto' | 'session'): AsyncGenerator<ChatChunk, 'handled' | 'fallback'> {
    const messageId = randomUUID()
    const body = { ...basic, ...extras, session_id: `mes-${randomUUID()}`, id: messageId, parent_id: null, params: { tool_approval_mode: 'full' } }
    if (req.signal?.aborted) { yield { type: 'error', message: CANCELLED }; return 'handled' }
    await req.onDispatch?.(extras ? toolDelivery(extras) : { mode: 'basic' }, body)
    let res: Response
    try {
      res = await limitedFetch(joinUrl(this.settings.baseUrl, 'chat/completions'), { method: 'POST', headers: this.headers(), body: JSON.stringify(body) }, { signal: req.signal })
    } catch (e) {
      yield { type: 'error', message: errorMessage(e) }
      return 'handled'
    }
    const fallback = mode === 'auto' && !req.signal?.aborted
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined)
      if (fallback && res.status >= 400 && res.status < 500) return 'fallback'
      yield { type: 'error', message: `LLM 서비스 오류 (HTTP ${res.status})` }
      return 'handled'
    }
    // 세션을 모르는 OpenWebUI는 같은 요청을 스트리밍으로 이미 처리 중이다 — 다시 보내지 않고 그대로 읽는다
    if (res.headers.get('content-type')?.includes('text/event-stream')) {
      yield* this.readSse(res.body, Number.POSITIVE_INFINITY)
      return 'handled'
    }
    let created: unknown
    try { created = await res.json() } catch (e) {
      if (e instanceof LimitedFetchError) { yield { type: 'error', message: errorMessage(e) }; return 'handled' }
    }
    const chatId = isObject(created) && typeof created.chat_id === 'string' && created.chat_id ? created.chat_id : undefined
    if (!chatId) {
      if (fallback) return 'fallback'
      yield { type: 'error', message: 'LLM 서비스 응답 형식 오류' }
      return 'handled'
    }
    yield* this.pollSession(req, chatId, messageId)
    return 'handled'
  }

  /** 채팅을 폴링해 누적 본문·생각의 증가분을 낸다. 끝·실패·취소 어느 쪽이든 마지막 청크 전에 중지·정리를 마친다. */
  private async *pollSession(req: ChatRequest, chatId: string, messageId: string): AsyncGenerator<ChatChunk> {
    const chatPath = `v1/chats/${encodeURIComponent(chatId)}`
    let finished = false, cleaned = false
    const call = async (method: 'POST' | 'DELETE', path: string) => {
      try {
        const res = await limitedFetch(joinUrl(this.settings.baseUrl, path), { method, headers: this.headers() }, { timeoutMs: SESSION_CLEANUP_TIMEOUT_MS })
        await res.body?.cancel().catch(() => undefined)
      } catch { /* 정리 실패는 응답 결과를 바꾸지 않는다 */ }
    }
    const cleanup = async () => {
      if (cleaned) return
      cleaned = true
      if (!finished) await call('POST', `tasks/chat/${encodeURIComponent(chatId)}/stop`)
      if (req.owuiCleanup !== false) await call('DELETE', chatPath)
    }
    try {
      await req.onSession?.(chatId)
      let content = '', reasoning = '', statusCount = 0, failures = 0
      while (true) {
        if (req.signal?.aborted) { await cleanup(); yield { type: 'error', message: CANCELLED }; return }
        let message: Record<string, unknown> | undefined
        try {
          const res = await limitedFetch(joinUrl(this.settings.baseUrl, chatPath), { headers: this.headers() },
            { timeoutMs: SESSION_POLL_TIMEOUT_MS, maxResponseBytes: SESSION_POLL_MAX_BYTES, signal: req.signal })
          if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw new Error(`HTTP ${res.status}`) }
          const chat: unknown = await res.json()
          const messages = isObject(chat) && isObject(chat.chat) && isObject(chat.chat.history) ? chat.chat.history.messages : undefined
          if (!isObject(messages)) throw new Error('응답 형식 오류')
          message = isObject(messages[messageId]) ? messages[messageId] : undefined
          failures = 0
        } catch {
          if (req.signal?.aborted) continue
          if (++failures >= SESSION_POLL_FAILURES) { await cleanup(); yield { type: 'error', message: 'LLM 서비스 응답 확인 실패 (OpenWebUI 채팅 조회)' }; return }
        }
        if (message) {
          const next = readSessionMessage(message)
          if (next.statuses.length > statusCount) {
            // 새 상태를 모두 낸다. 새 항목이 숨김뿐이면 마지막 보이는 상태로 생존 신호만 준다
            const fresh = next.statuses.slice(statusCount).filter((text): text is string => !!text)
            const latest = next.statuses.findLast((text): text is string => !!text)
            statusCount = next.statuses.length
            for (const text of fresh.length ? fresh : latest ? [latest] : []) yield { type: 'status', text }
          }
          if (next.reasoning !== reasoning) {
            yield next.reasoning.startsWith(reasoning) ? { type: 'reasoning', text: next.reasoning.slice(reasoning.length) } : { type: 'replace', field: 'reasoning', text: next.reasoning }
            reasoning = next.reasoning
          }
          if (next.content !== content) {
            yield next.content.startsWith(content) ? { type: 'delta', text: next.content.slice(content.length) } : { type: 'replace', field: 'content', text: next.content }
            content = next.content
          }
          if (next.error || next.done) {
            finished = true
            await cleanup()
            yield next.error ? { type: 'error', message: 'LLM 서비스 오류 (OpenWebUI 작업 실패)' } : { type: 'done' }
            return
          }
        }
        await sleep(this.sessionPollMs, req.signal)
      }
    } finally {
      await cleanup()
    }
  }
}
