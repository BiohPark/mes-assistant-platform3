import { boundRawResponse, RAW_RESPONSE_MAX_BYTES, stepProjection, boundStepPayload, type AnswerStep } from '@mes/domain'
import { parseContent } from './contentSteps.js'
import { sessionSteps } from './answerSteps.js'
import { collectResponseImages } from './responseImages.js'
import { randomUUID } from 'node:crypto'
import type { ChatChunk, ChatProvider, ChatRequest } from './provider.js'
import { LimitedFetchError, limitedFetch, toLimitedFetchError } from './limitedFetch.js'
import { extractDelta, parseSseLines, type ToolCallFragment } from './sse.js'
import { owuiModelTools, owuiTerminal, type OwuiDefaults } from './owuiProbe.js'
import { OwuiTerminalCatalog, type OwuiSettings, type OwuiTerminalSource } from './owuiTerminals.js'

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
/** 본문·생각·상태가 이만큼 그대로면 '멈춤' — 마무리 단계를 알리고 OpenWebUI 작업이 끝났는지 확인한다 */
const SESSION_SETTLE_MS = 3_000
/** 본문이 멈춘 뒤 OpenWebUI가 하는 일 — 서버 단계 문구(화면이 번역한다) */
const SESSION_PHASE = { finishing: '답변 마무리 중', tool: '도구 실행 중: ', code: '코드 실행 중', working: 'OpenWebUI에서 작업 중' } as const
const ENDED_EMPTY = 'LLM 서비스 응답 없음 (OpenWebUI 작업이 답 없이 끝남)'
const CANCELLED = '요청이 취소되었습니다.'

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function errorMessage(e: unknown): string {
  return toLimitedFetchError(e).message
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** A wrapper tag start (<think>, <details …>) anywhere in the text. */
const WRAPPER = /<\/?(?:details|think)\b/i
const WRAPPER_PREFIXES = ['<details', '<think', '</details', '</think']
const WRAPPER_PREFIX_MAX = 10
/** Length of a trailing partial wrapper tag ('<', '<det', '</thi') held back until the next delta decides it. */
function heldWrapperPrefix(text: string): number {
  const at = text.lastIndexOf('<')
  if (at < 0 || text.length - at > WRAPPER_PREFIX_MAX) return 0
  const tail = text.slice(at).toLowerCase()
  return WRAPPER_PREFIXES.some(tag => tag.startsWith(tail)) ? text.length - at : 0
}

/** 채팅 메시지의 누적 본문·생각·최근 상태. 본문은 OpenWebUI get_output_text와 같게(message 항목, 공백뿐인 항목 제외, 줄바꿈 연결) 만든다 */
function readSessionMessage(message: Record<string, unknown>, steps: AnswerStep[]) {
  const output = Array.isArray(message.output) ? message.output.filter(isObject) : []
  const { content, reasoning } = stepProjection(steps)
  const history = Array.isArray(message.statusHistory) ? message.statusHistory : []
  // 상태 항목마다 보이는 문구(숨김·빈 문구는 undefined) — 폴링 사이에 지나간 단계도 놓치지 않는다
  const statuses = history.map((item) => isObject(item) && item.hidden !== true && typeof item.description === 'string' && item.description.trim()
    ? item.description.trim().slice(0, SESSION_STATUS_MAX) : undefined)
  return { content, reasoning, statuses, activity: sessionActivity(output), output: JSON.stringify(output),
    done: message.done === true, error: message.error !== undefined && message.error !== null && message.error !== false }
}

/**
 * 진행 중인 도구·코드 — 결과(function_call_output)가 아직 없는 function_call(middleware.py 5997-6005·6158-6168),
 * 끝나지 않은 코드 실행 항목(open_webui:code_interpreter, 4645-4658). 없으면 undefined
 */
function sessionActivity(output: Record<string, unknown>[]): string | undefined {
  const answered = new Set(output.filter((item) => item.type === 'function_call_output').map((item) => item.call_id))
  const tool = output.findLast((item) => item.type === 'function_call' && !answered.has(item.call_id))
  if (tool) return `${SESSION_PHASE.tool}${typeof tool.name === 'string' && tool.name.trim() ? tool.name.trim().slice(0, SESSION_STATUS_MAX) : '?'}`
  if (output.some((item) => item.type === 'open_webui:code_interpreter' && item.status === 'in_progress')) return SESSION_PHASE.code
  return undefined
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return }
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

/** 전송 기록은 실제 전달한 터미널 ID와 선택 출처를 함께 보관한다. 출처는 OWUI 본문에 싣지 않는다. */
const toolDelivery = ({ tool_ids, features, terminal_id }: OwuiDefaults, terminalSource: OwuiTerminalSource) => ({ mode: 'tools' as const, ...(tool_ids ? { tool_ids } : {}), ...(features ? { features } : {}), ...(terminal_id ? { terminal_id } : {}), terminalSource })

function parseModelIds(body: unknown): string[] {
  const data = body !== null && typeof body === 'object' ? (body as { data?: unknown }).data : undefined
  if (!Array.isArray(data) || !data.every((m) => m !== null && typeof m === 'object' && typeof m.id === 'string')) throw new Error('응답 형식 오류')
  return data.map((m) => m.id)
}

/** OpenAI-compatible /chat/completions 스트리밍 클라이언트 (OpenWebUI 포함) */
export class OpenAICompatibleProvider implements ChatProvider {
  readonly kind = 'live' as const
  private readonly settings: OwuiSettings
  private readonly terminals = new OwuiTerminalCatalog()
  private modelMeta?: { body: unknown; expires: number }

  private async modelTools(model: string, messages: ChatRequest['messages'], signal?: AbortSignal) {
    if (!this.modelMeta || this.modelMeta.expires <= Date.now()) {
      const res = await limitedFetch(joinUrl(this.settings.baseUrl, 'models'), { headers: this.headers() },
        { timeoutMs: MODELS_TIMEOUT_MS, maxResponseBytes: MODELS_MAX_BYTES, signal })
      if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw new Error('모델 메타 조회 실패') }
      const body: unknown = await res.json()
      parseModelIds(body)
      this.modelMeta = { body, expires: Date.now() + 5 * 60_000 }
    }
    const defaultTerminalId = await this.settings.readOwuiDefaultTerminalId?.()
    let terminals
    try { terminals = await this.terminals.list(this.settings, signal) } catch { /* 목록 실패가 모델 도구 전달을 막지 않는다. */ }
    const defaults = owuiModelTools(this.modelMeta.body, model, this.settings.apiKey, messages, { defaultTerminalId, terminals })
    const entry = isObject(this.modelMeta.body) && Array.isArray(this.modelMeta.body.data) ? this.modelMeta.body.data.find(item => isObject(item) && item.id === model) : undefined
    const meta = isObject(entry) && isObject(entry.info) && isObject(entry.info.meta) ? entry.info.meta : undefined
    const terminalSource = owuiTerminal(meta, { defaultTerminalId, terminals }).source
    return { defaults, terminalSource }
  }

  private readonly sessionPollMs: number
  private readonly sessionSettleMs: number

  constructor(settings: OwuiSettings, private readonly readOwuiTools?: () => Promise<'auto' | 'off'>, options: { sessionPollMs?: number; sessionSettleMs?: number } = {}) {
    this.settings = settings
    this.sessionPollMs = options.sessionPollMs ?? SESSION_POLL_MS
    this.sessionSettleMs = options.sessionSettleMs ?? SESSION_SETTLE_MS
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
    let terminalSource: OwuiTerminalSource = 'none'
    if (this.settings.preset === 'openwebui' && !req.tools?.length) {
      try {
        const mode = req.owuiTools ?? (this.readOwuiTools ? await this.readOwuiTools() : this.settings.owuiTools ?? 'auto')
        const meta = mode === 'auto' ? await this.modelTools(String(basic.model), req.messages, req.signal) : undefined
        if (meta) { terminalSource = meta.terminalSource; if (Object.keys(meta.defaults).length) extras = meta.defaults }
      } catch { /* 메타·설정 조회 실패는 기본 전송으로 진행한다. */ }
    }
    // 세션 모드는 지정한 대화 요청만 — 앱 도구 호출·시험(limits) 호출은 기존 방식을 쓴다
    if (this.settings.preset === 'openwebui' && !req.tools?.length && !req.limits && (req.owuiMode === 'auto' || req.owuiMode === 'session')) {
      if ((yield* this.streamSession(req, basic, extras, req.owuiMode, terminalSource)) === 'handled') return
    }
    for (let attempt = 0; attempt < (extras ? 2 : 1); attempt++) {
      const enhanced = !!extras && attempt === 0
      const body = enhanced ? { ...basic, ...extras, params: { function_calling: 'legacy' } } : basic
      const delivery = enhanced && extras ? toolDelivery(extras, terminalSource) : { mode: attempt ? 'fallback' as const : 'basic' as const, terminalSource: 'none' as const }
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
      yield* this.readSse(req, res.body, maxFrameBytes)
      return
    }
  }

  /** SSE 응답 본문 → 청크. 끝나면 done, 실패하면 error 하나로 끝낸다. */
  private async *readSse(req: ChatRequest, body: ReadableStream<Uint8Array>, maxFrameBytes: number): AsyncGenerator<ChatChunk> {
    const reader = body.getReader()
    const steps: AnswerStep[] = []
    const toolSteps = new Map<number, number>()
    const finishTools = (status: 'done' | 'error') => {
      for (const index of toolSteps.values()) {
        const current = steps[index]
        if (current?.type === 'tool') {
          const step: AnswerStep = { ...current, status }
          steps[index] = step
          req.onStep?.(index, step, steps.length)
        }
      }
    }
    const firstFrames: string[] = [], lastFrames: string[] = []
    let frameCount = 0, frameBytes = 0, sampleBytes = 0, oversized = false
    const recordFrame = (frame: string) => {
      const bytes = new TextEncoder().encode(frame).byteLength
      frameCount++; frameBytes += bytes
      if (oversized) return
      if (sampleBytes + bytes > RAW_RESPONSE_MAX_BYTES) { oversized = true; firstFrames.length = lastFrames.length = 0; return }
      if (firstFrames.length < 8) { firstFrames.push(frame); sampleBytes += bytes }
      else {
        lastFrames.push(frame); sampleBytes += bytes
        if (lastFrames.length > 8) sampleBytes -= new TextEncoder().encode(lastFrames.shift()!).byteLength
      }
    }
    try {
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let buffer = '', content = ''
      // Text deltas may carry OWUI wrappers (<think>, <details type=…>). Only the unsettled tail is re-parsed:
      // a closed top-level wrapper settles everything before it, and plain text without any wrapper takes a constant-time path.
      let markup = '', markupStart = 0, markupActive = false, tagged = false
      // Open reasoning at the end of markup: plain deltas extend it in place. trailing = whitespace the parser trims off for now.
      let openReasoning: { trailing: string } | undefined
      const emitStep = (index: number, step: AnswerStep, count: number) => { steps[index] = step; req.onStep?.(index, step, count) }
      const parseText = function* (text: string, final = false): Generator<ChatChunk> {
        if (!markupActive) { markupStart = steps.length; markupActive = true; tagged = false; openReasoning = undefined }
        const window = markup.slice(-WRAPPER_PREFIX_MAX) + text
        markup += text
        // Characters that can change tags, fences or entities send the delta through the full parse. Quote unwrapping cannot
        // flip: shown verbatim means some fixed earlier line is unquoted, and appending never changes an earlier line's start.
        if (openReasoning && !final && !/[<&`~]/.test(window)) {
          const last = steps.at(-1)
          if (last?.type === 'reasoning') {
            const combined = openReasoning.trailing + text
            const kept = combined.trimEnd()
            openReasoning.trailing = combined.slice(kept.length)
            if (!kept) return
            emitStep(steps.length - 1, { type: 'reasoning', text: last.text + kept }, steps.length)
            yield { type: 'reasoning', text: kept }
            return
          }
        }
        openReasoning = undefined
        if (!tagged && WRAPPER.test(window)) tagged = true
        if (!tagged) {
          const hold = final ? 0 : heldWrapperPrefix(markup)
          const visible = hold ? markup.slice(0, -hold) : markup
          const prev = steps.length > markupStart ? steps[markupStart] : undefined
          const prevText = prev?.type === 'text' ? prev.text : ''
          if (!visible.trim() || visible.length === prevText.length) return
          emitStep(markupStart, { type: 'text', text: visible }, markupStart + 1)
          yield { type: 'delta', text: prev ? visible.slice(prevText.length) : visible }
          return
        }
        const previous = stepProjection(steps)
        const parsed = parseContent(markup, !final)
        const count = markupStart + parsed.steps.length
        parsed.steps.forEach((step, offset) => {
          const index = markupStart + offset
          if (JSON.stringify(step) !== JSON.stringify(steps[index]) || (count < steps.length && offset === parsed.steps.length - 1)) emitStep(index, step, count)
        })
        steps.length = count
        const next = stepProjection(steps)
        for (const field of ['content', 'reasoning'] as const) {
          if (previous[field] === next[field]) continue
          yield next[field].startsWith(previous[field]) ? { type: field === 'content' ? 'delta' : 'reasoning', text: next[field].slice(previous[field].length) } : { type: 'replace', field, text: next[field] }
        }
        if (parsed.openReasoning && !final && !/</.test(markup.slice(-WRAPPER_PREFIX_MAX))) openReasoning = { trailing: /\s*$/.exec(markup)![0] }
        if (parsed.settled > 0) {
          markup = markup.slice(parsed.settled)
          markupStart += parsed.settledSteps
          // Settled steps are final; the tail step parsed above stays at markupStart for the next delta.
          tagged = WRAPPER.test(markup)
        }
      }
      const endMarkup = () => { markup = ''; markupActive = false; openReasoning = undefined }
      // toolAcc/toolSteps are keyed by call slot; toolRound maps the stream's tool index to the slot of its current call.
      const toolAcc = new Map<number, ToolCallFragment>(), toolRound = new Map<number, number>()
      const pushText = (type: 'text' | 'reasoning', text: string) => {
        if (!text) return
        const last = steps.at(-1)
        const index = last?.type === type ? steps.length - 1 : steps.length
        const step: AnswerStep = { type, text: (last?.type === type ? last.text : '') + text }
        steps[index] = step
        req.onStep?.(index, step, steps.length)
      }
      // [DONE]이 끝이다 — OpenWebUI는 [DONE]을 보낸 뒤 outlet 필터를 기다리느라 연결을 더 열어 둔다(middleware.py 6748-6760)
      let ended = false
      while (!ended) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = parseSseLines(buffer)
        buffer = rest
        for (const ev of events) {
          recordFrame(ev)
          if (ev === '[DONE]') { ended = true; break }
          if (Number.isFinite(maxFrameBytes) && encoder.encode(ev).byteLength > maxFrameBytes) {
            await reader.cancel().catch(() => undefined)
            finishTools('error')
            yield { type: 'error', message: FRAME_TOO_LARGE }
            return
          }
          let parsed: unknown
          try {
            parsed = JSON.parse(ev)
          } catch {
            continue
          }
          if (isObject(parsed) && Array.isArray(parsed.sources)) {
            endMarkup()
            for (const source of parsed.sources) {
              const name = isObject(source) && isObject(source.source) && typeof source.source.name === 'string' ? source.source.name : 'sources'
              const step: AnswerStep = { type: 'tool', name, input: '', output: boundStepPayload(JSON.stringify(source)), status: 'done', source: true }
              const index = steps.length
              steps.push(step)
              req.onStep?.(index, step, steps.length)
            }
          }
          const { text, reasoning, toolCalls } = extractDelta(parsed)
          if (reasoning) { endMarkup(); pushText('reasoning', reasoning); yield { type: 'reasoning', text: reasoning } }
          if (text) yield* parseText(text)
          if (toolCalls.length) endMarkup()
          for (const tc of toolCalls) {
            // A later round reuses index 0 with a new id — that is a new call and a new step, not more arguments for the old one.
            let slot = toolRound.get(tc.index)
            let prev = slot === undefined ? undefined : toolAcc.get(slot)
            if (slot === undefined || (tc.id && prev?.id && tc.id !== prev.id)) { slot = toolAcc.size; toolRound.set(tc.index, slot); prev = undefined }
            toolAcc.set(slot, {
              index: tc.index,
              id: tc.id ?? prev?.id,
              name: tc.name ?? prev?.name,
              arguments: (prev?.arguments ?? '') + tc.arguments,
            })
            let index = toolSteps.get(slot)
            if (index === undefined) { index = steps.length; toolSteps.set(slot, index) }
            const call = toolAcc.get(slot)!
            const step: AnswerStep = { type: 'tool', name: call.name ?? '?', input: boundStepPayload(call.arguments), output: '', status: 'running' }
            steps[index] = step
            req.onStep?.(index, step, steps.length)
          }
        }
        if (Number.isFinite(maxFrameBytes) && encoder.encode(buffer).byteLength > maxFrameBytes) {
          await reader.cancel().catch(() => undefined)
          finishTools('error')
          yield { type: 'error', message: FRAME_TOO_LARGE }
          return
        }
      }
      if (markupActive) yield* parseText('', true)
      finishTools(req.signal?.aborted ? 'error' : 'done')
      for (const tc of toolAcc.values()) {
        if (tc.name) yield { type: 'tool_call', call: { id: tc.id ?? `call_${tc.index}`, name: tc.name, arguments: tc.arguments } }
      }
      content = stepProjection(steps).content
      const images = await collectResponseImages(this.settings, content, undefined, req.signal, req.onResponseImages)
      if (!req.onResponseImages && (images.images.length || images.failures.length)) yield { type: 'images', ...images }
      if (req.signal?.aborted) { yield { type: 'error', message: req.signal.reason === 'timeout' ? '응답 시간 초과' : CANCELLED }; return }
      yield { type: 'done' }
    } catch (e) {
      finishTools('error')
      yield { type: 'error', message: errorMessage(e) }
    } finally {
      req.onRawResponse?.(oversized ? { bytes: frameBytes } : boundRawResponse({ mode: 'direct', frameCount, bytes: frameBytes, firstFrames, lastFrames }))
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
    mode: 'auto' | 'session', terminalSource: OwuiTerminalSource): AsyncGenerator<ChatChunk, 'handled' | 'fallback'> {
    const messageId = randomUUID()
    const body = { ...basic, ...extras, session_id: `mes-${randomUUID()}`, id: messageId, parent_id: null, params: { tool_approval_mode: 'full' } }
    if (req.signal?.aborted) { yield { type: 'error', message: CANCELLED }; return 'handled' }
    await req.onDispatch?.(extras ? toolDelivery(extras, terminalSource) : { mode: 'basic', terminalSource: 'none' }, body)
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
      yield* this.readSse(req, res.body, Number.POSITIVE_INFINITY)
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
    /** 진행 작업 ID 목록(main.py 2171-2189). 엔드포인트가 없거나 모양이 다르면 null — 이후 묻지 않는다. 일시 오류는 undefined */
    const taskIds = async (): Promise<string[] | null | undefined> => {
      try {
        const res = await limitedFetch(joinUrl(this.settings.baseUrl, `tasks/chat/${encodeURIComponent(chatId)}`), { headers: this.headers() },
          { timeoutMs: SESSION_POLL_TIMEOUT_MS, maxResponseBytes: 1024 * 1024, signal: req.signal })
        if (!res.ok) { await res.body?.cancel().catch(() => undefined); return res.status >= 500 ? undefined : null }
        const body: unknown = await res.json()
        return isObject(body) && Array.isArray(body.task_ids) ? body.task_ids : null
      } catch { return undefined }
    }
    try {
      await req.onSession?.(chatId)
      let previousSteps: AnswerStep[] = []
      let content = '', reasoning = '', output = '', statusCount = 0, failures = 0
      // changedAt: 마지막 변화(본문·생각·상태·output) 시각. shown: 이 폴링이 마지막으로 알린 단계(본문이 자라면 서버가 '답변 중'으로 바꾸므로 비운다).
      // lastStatus: 본문이 자란 뒤 마지막 OpenWebUI 상태. tasksKnown: 작업 목록 엔드포인트가 있는지. working: 멈춘 동안 작업이 살아 있다고 확인됨
      let changedAt = Date.now(), changed = true, shown: string | undefined, lastStatus: string | undefined, tasksKnown = true, tasksAt = 0, working = false
      while (true) {
        if (req.signal?.aborted) { await cleanup(); yield { type: 'error', message: CANCELLED }; return }
        // 멈춘 동안 작업 목록을 본다(main.py 2171-2189) — 있으면 OpenWebUI가 아직 일하는 중(생존 신호), 없는데 done이 없으면 done은 오지 않는다:
        // OpenWebUI는 done을 쓴 뒤에 작업을 지운다(middleware.py 6598-6612 → main.py 1755-1759; 응답 없는 비스트리밍 4309-4312, 처리 예외 4429-4432는 done 없이 끝난다).
        // 확인은 채팅 조회 전에 해 다음 조회가 마지막 상태다
        const stalled = !changed && Date.now() - changedAt >= this.sessionSettleMs
        let ended = false, active = false
        if (stalled && tasksKnown && Date.now() - tasksAt >= this.sessionSettleMs) {
          tasksAt = Date.now()
          const ids = await taskIds()
          if (ids === null) tasksKnown = false
          else if (ids?.length === 0) ended = true
          else if (ids) active = true
        }
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
        changed = false
        if (message) {
          // The receiver keeps the latest poll in memory and bounds it once when it persists the terminal state.
          req.onRawResponse?.({ mode: 'session', message })
          // One parse per poll serves both the step snapshots and the legacy content/reasoning projection.
          const steps = sessionSteps(message)
          const next = readSessionMessage(message, steps)
          // Final empty output sometimes omits in-flight content; retain the last visible steps.
          if (steps.length) {
            steps.forEach((step, index) => {
              if (JSON.stringify(step) !== JSON.stringify(previousSteps[index]) || (steps.length < previousSteps.length && index === steps.length - 1)) req.onStep?.(index, step, steps.length)
            })
            previousSteps = steps
          }
          const statused = next.statuses.length > statusCount
          if (statused) {
            // 새 상태를 모두 낸다. 새 항목이 숨김뿐이면 마지막 보이는 상태로 생존 신호만 준다
            const fresh = next.statuses.slice(statusCount).filter((text): text is string => !!text)
            const latest = next.statuses.findLast((text): text is string => !!text)
            statusCount = next.statuses.length
            for (const text of fresh.length ? fresh : latest ? [latest] : []) yield { type: 'status', text }
            if (latest) shown = lastStatus = latest
          }
          // 작업이 끝났는데 마지막 조회에 본문이 비면(진행 본문은 response_streams에만 있다 — middleware.py 6598-6600) 보인 글을 지우지 않는다
          const keep = ended && !next.content.trim() && !!content.trim()
          const grew = next.reasoning !== reasoning || (next.content !== content && !keep)
          if (next.reasoning !== reasoning) {
            yield next.reasoning.startsWith(reasoning) ? { type: 'reasoning', text: next.reasoning.slice(reasoning.length) } : { type: 'replace', field: 'reasoning', text: next.reasoning }
            reasoning = next.reasoning
          }
          if (next.content !== content && !keep) {
            yield next.content.startsWith(content) ? { type: 'delta', text: next.content.slice(content.length) } : { type: 'replace', field: 'content', text: next.content }
            content = next.content
          }
          if (next.error || next.done || ended) {
            finished = true
            if (!next.error && (next.done || content.trim())) {
              const images = await collectResponseImages(this.settings, content, message, req.signal, req.onResponseImages)
              if (!req.onResponseImages && (images.images.length || images.failures.length)) yield { type: 'images', ...images }
            }
            await cleanup()
            if (req.signal?.aborted) { yield { type: 'error', message: req.signal.reason === 'timeout' ? '응답 시간 초과' : CANCELLED }; return }
            yield next.error ? { type: 'error', message: 'LLM 서비스 오류 (OpenWebUI 작업 실패)' } : next.done || content.trim() ? { type: 'done' } : { type: 'error', message: ENDED_EMPTY }
            return
          }
          // 도구 호출·코드 실행 같은 output 변화도 진행이다(본문은 그대로여도)
          const outputChanged = next.output !== output
          output = next.output
          if (grew) { shown = lastStatus = undefined }
          if (grew || statused || outputChanged) { changed = true; changedAt = Date.now(); working = false }
          if (active) working = true
          // 본문이 멈춘 뒤에도 끝나지 않았으면 무엇을 하는지 알린다 — OpenWebUI 상태 > 진행 중 도구·코드 > 마무리 중.
          // 작업 목록이 살아 있다고 하면 'OpenWebUI에서 작업 중'을 앞에 붙이고, 확인할 때마다 같은 단계를 다시 내 무응답 제한을 다시 건다
          const quiet = !grew && Date.now() - changedAt >= this.sessionSettleMs
          const base = lastStatus ?? next.activity ?? (content.trim() && quiet ? SESSION_PHASE.finishing : undefined)
          const phase = working ? (base ? `${SESSION_PHASE.working} · ${base}` : SESSION_PHASE.working) : base
          // OpenWebUI 상태가 방금 왔으면 그 문구가 더 구체적이다 — 같은 폴링에서는 덮지 않는다
          if (!statused && phase && (phase !== shown || active || (outputChanged && !grew))) {
            shown = phase
            yield { type: 'status', text: phase }
          }
        }
        await sleep(this.sessionPollMs, req.signal)
      }
    } finally {
      await cleanup()
    }
  }
}
