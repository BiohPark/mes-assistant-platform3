import type { LlmSettings } from '@mes/domain'
import { LimitedFetchError, limitedFetch, toLimitedFetchError } from './limitedFetch.js'
import { parseSseLines } from './sse.js'

/**
 * OpenWebUI 연동 진단(SO 전용, S10-5) — 버전·모델 메타·두 방식의 짧은 시험 호출을 모은다.
 * 결과는 허용 목록 방식이다(S10-5 리뷰): 알려진 이름·형식만 내보내고 나머지는 고정 표기(기타·(가림))로 바꾼다.
 * 오류는 상태 코드 + 고정 분류뿐이며 상위 응답 본문은 읽지 않는다.
 * 일반 채팅 경로(OpenAICompatibleProvider.stream)와 별개다.
 */

/** 고정 시험 질문 — 결과에는 싣지 않는다 */
export const OWUI_PROBE_PROMPT = 'Reply with the single word OK.'
const DEADLINE_MS = 180_000
const VERSION_TIMEOUT_MS = 10_000
const MODELS_TIMEOUT_MS = 15_000
const ATTEMPT_TIMEOUT_MS = 75_000
const MODELS_MAX_BYTES = 4 * 1024 * 1024
const SMALL_MAX_BYTES = 64 * 1024
const ATTEMPT_MAX_BYTES = 1024 * 1024
const MAX_RUNS = 40
const MAX_IDS = 20
/** 매 프레임 붙는 봉투 키 — 순서 기록에서 뺀다 */
const ENVELOPE = new Set(['id', 'object', 'created', 'model', 'system_fingerprint', 'service_tier'])

export type OwuiProbeMode = 'current' | 'legacy'
export interface OwuiProbeAttempt {
  mode: OwuiProbeMode
  status: number | null
  firstByteMs: number | null
  firstContentMs: number | null
  totalMs: number
  /** 프레임 종류 순서 — 같은 종류가 이어지면 `×N`으로 접는다 */
  frames: string[]
  error?: string
}
export interface OwuiProbeMeta {
  found: boolean
  toolIds: string[]
  defaultFeatureIds: string[]
  capabilities: Record<string, boolean>
  knowledgeCount: number
  functionCalling: string | null
  error?: string
}
export interface OwuiProbeResult {
  model: string
  /** null = 확인 불가 */
  version: string | null
  meta: OwuiProbeMeta
  attempts: OwuiProbeAttempt[]
  ms: number
}
export interface OwuiProbeOptions {
  signal?: AbortSignal
  /** 전체 시간 상한 (기본 3분) */
  deadlineMs?: number
  /** 시험 호출 하나의 응답 바이트 상한 (기본 1 MB) */
  maxResponseBytes?: number
}

/** 허용 목록 밖의 값 — 계약(@mes/contracts OwuiProbeResultSchema)과 같은 표기 */
export const OWUI_PROBE_OTHER = '기타'
export const OWUI_PROBE_MASKED = '(가림)'
/** OpenWebUI 모델 편집의 Capabilities 이름 */
export const OWUI_KNOWN_CAPABILITIES = ['vision', 'file_upload', 'file_context', 'web_search', 'image_generation', 'code_interpreter', 'citations', 'status_updates', 'usage', 'builtin_tools'] as const
const FRAME_TOP_KEYS = new Set(['choices', 'sources', 'usage', 'error'])
const FRAME_INNER_KEYS = new Set(['role', 'content', 'reasoning_content', 'reasoning', 'tool_calls', 'function_call', 'refusal'])
const FUNCTION_CALLING = new Set(['native', 'legacy', 'default'])
/** 짧은 식별자(도구 서버 접두 server:·server:mcp: 허용) — 점·슬래시·숫자 시작(IP)·확장자·긴 값은 가린다 */
const SHORT_ID = /^(?:server:(?:mcp:)?)?[A-Za-z_][A-Za-z0-9_-]{0,39}$/
const VERSION = /^\d{1,4}(?:\.\d{1,4}){1,3}(?:-[A-Za-z0-9]{1,16})?$/
const elapsed = (started: number) => Math.round(performance.now() - started)
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isEmpty = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

/** 상태 코드별 고정 분류 — 상위 응답 본문은 쓰지 않는다 */
function httpError(status: number): string {
  const kind = status === 400 || status === 422 ? '형식 거부' : status === 401 || status === 403 ? '인증 거부' : status === 404 ? '찾을 수 없음'
    : status === 413 ? '크기 거부' : status === 429 ? '요청 제한' : status >= 500 ? '서버 오류' : '거부'
  return `HTTP ${status} · ${kind}`
}

/** 프레임 하나의 키 경로 — 값은 보지 않고, 알려진 키만 이름 그대로, 그 밖은 기타 */
export function frameKeyPaths(frame: unknown): string {
  if (!isObject(frame)) return 'non-json'
  const paths = new Set<string>()
  for (const [key, value] of Object.entries(frame)) {
    if (ENVELOPE.has(key) || isEmpty(value)) continue
    if (!FRAME_TOP_KEYS.has(key)) { paths.add(OWUI_PROBE_OTHER); continue }
    const choice = key === 'choices' && Array.isArray(value) ? value[0] : undefined
    if (!isObject(choice)) { paths.add(key === 'choices' ? 'choices' : key); continue }
    const inner: string[] = []
    for (const part of ['delta', 'message'] as const) {
      const body = choice[part]
      if (isObject(body)) inner.push(...Object.entries(body).filter(([, v]) => !isEmpty(v)).map(([k]) => `choices.${part}.${FRAME_INNER_KEYS.has(k) ? k : OWUI_PROBE_OTHER}`))
    }
    if (!isEmpty(choice.finish_reason)) inner.push('choices.finish_reason')
    for (const path of inner.length ? inner : [isObject(choice.delta) ? 'choices.delta' : 'choices']) paths.add(path)
  }
  return paths.size ? [...paths].join('+') : 'empty'
}

function hasContent(frame: unknown): boolean {
  if (!isObject(frame) || !Array.isArray(frame.choices)) return false
  const choice: unknown = frame.choices[0]
  return isObject(choice) && isObject(choice.delta) && typeof choice.delta.content === 'string' && choice.delta.content.length > 0
}

class FrameRuns {
  readonly runs: { kind: string; count: number }[] = []
  private overflow = false
  push(kind: string) {
    const last = this.runs.at(-1)
    if (last?.kind === kind) { last.count++; return }
    if (this.runs.length >= MAX_RUNS) { this.overflow = true; return }
    this.runs.push({ kind, count: 1 })
  }
  list(): string[] {
    return [...this.runs.map((run) => run.count > 1 ? `${run.kind} ×${run.count}` : run.kind), ...(this.overflow ? ['…'] : [])]
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}
const rootUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, '').replace(/\/api$/, '')

export async function probeOpenWebUi(settings: LlmSettings, model: string, options: OwuiProbeOptions = {}): Promise<OwuiProbeResult> {
  const started = performance.now()
  const deadline = started + (options.deadlineMs ?? DEADLINE_MS)
  const remaining = (cap: number) => Math.min(cap, Math.max(0, Math.floor(deadline - performance.now())))
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`
  const failure = (error: unknown) => toLimitedFetchError(error).message
  const shortId = (id: string) => SHORT_ID.test(id) && !(settings.apiKey && id.includes(settings.apiKey)) ? id : OWUI_PROBE_MASKED
  async function getJson(url: string, cap: number, maxResponseBytes: number): Promise<unknown> {
    const timeoutMs = remaining(cap)
    if (timeoutMs <= 0) throw new LimitedFetchError('timeout')
    const res = await limitedFetch(url, { headers }, { timeoutMs, maxResponseBytes, signal: options.signal })
    if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw new Error(httpError(res.status)) }
    // JSON 파서 오류 문구는 본문 일부를 인용할 수 있다 — 고정 문구로 바꾼다
    try { return await res.json() } catch (error) { throw error instanceof LimitedFetchError ? error : new Error('응답 형식 오류') }
  }

  let version: string | null = null
  try {
    const body = await getJson(joinUrl(rootUrl(settings.baseUrl), 'api/version'), VERSION_TIMEOUT_MS, SMALL_MAX_BYTES)
    const value = isObject(body) ? body.version : undefined
    if (typeof value === 'string' && VERSION.test(value)) version = value
  } catch { /* 확인 불가 */ }

  const meta: OwuiProbeMeta = { found: false, toolIds: [], defaultFeatureIds: [], capabilities: {}, knowledgeCount: 0, functionCalling: null }
  try {
    const body = await getJson(joinUrl(settings.baseUrl, 'models'), MODELS_TIMEOUT_MS, MODELS_MAX_BYTES)
    const data = isObject(body) && Array.isArray(body.data) ? body.data : []
    const entry: unknown = data.find((item) => isObject(item) && item.id === model)
    const info = isObject(entry) && isObject(entry.info) ? entry.info : undefined
    const raw = info && isObject(info.meta) ? info.meta : undefined
    if (info) {
      meta.found = true
      // 개수는 그대로 — 형식에 맞지 않는 항목은 (가림)으로 바꾼다
      const ids = (value: unknown) => Array.isArray(value) ? value.slice(0, MAX_IDS).map((id) => typeof id === 'string' ? shortId(id) : OWUI_PROBE_MASKED) : []
      meta.toolIds = ids(raw?.toolIds)
      meta.defaultFeatureIds = ids(raw?.defaultFeatureIds)
      if (isObject(raw?.capabilities)) {
        const capabilities = raw.capabilities
        meta.capabilities = Object.fromEntries(OWUI_KNOWN_CAPABILITIES.filter((name) => typeof capabilities[name] === 'boolean').map((name) => [name, capabilities[name] as boolean]))
      }
      meta.knowledgeCount = Array.isArray(raw?.knowledge) ? raw.knowledge.length : 0
      // OpenWebUI는 function_calling을 info.params에 둔다(옛 기록 대비 meta.params도 본다)
      const params = isObject(info.params) ? info.params : isObject(raw?.params) ? raw.params : undefined
      const fc = params?.function_calling
      meta.functionCalling = typeof fc === 'string' ? (FUNCTION_CALLING.has(fc) ? fc : OWUI_PROBE_OTHER) : null
    }
  } catch (error) {
    // LimitedFetchError는 고정 문구, 그 밖은 httpError의 고정 분류나 '응답 형식 오류'뿐
    meta.error = error instanceof LimitedFetchError || !(error instanceof Error) ? failure(error) : error.message
  }

  const messages = [{ role: 'user', content: OWUI_PROBE_PROMPT }]
  const bodies: Record<OwuiProbeMode, Record<string, unknown>> = {
    current: { model, messages, stream: true },
    legacy: { model, messages, stream: true, tool_ids: meta.toolIds.filter((id) => id !== OWUI_PROBE_MASKED),
      features: Object.fromEntries(meta.defaultFeatureIds.filter((id) => id !== OWUI_PROBE_MASKED).map((id) => [id, true])), params: { function_calling: 'legacy' } },
  }

  async function attempt(mode: OwuiProbeMode): Promise<OwuiProbeAttempt> {
    const begin = performance.now()
    const result: OwuiProbeAttempt = { mode, status: null, firstByteMs: null, firstContentMs: null, totalMs: 0, frames: [] }
    const runs = new FrameRuns()
    const finish = (error?: string) => {
      result.totalMs = elapsed(begin)
      result.frames = runs.list()
      if (error) result.error = error
      return result
    }
    const timeoutMs = remaining(ATTEMPT_TIMEOUT_MS)
    if (timeoutMs <= 0) return finish(new LimitedFetchError('timeout').message)
    let res: Response
    try {
      res = await limitedFetch(joinUrl(settings.baseUrl, 'chat/completions'), { method: 'POST', headers, body: JSON.stringify(bodies[mode]) },
        { timeoutMs, maxResponseBytes: options.maxResponseBytes ?? ATTEMPT_MAX_BYTES, signal: options.signal })
    } catch (error) { return finish(failure(error)) }
    result.status = res.status
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined)
      return finish(httpError(res.status))
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        result.firstByteMs ??= elapsed(begin)
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = parseSseLines(buffer)
        buffer = rest
        for (const event of events) {
          if (event === '[DONE]') { runs.push('[DONE]'); continue }
          let parsed: unknown
          try { parsed = JSON.parse(event) } catch { parsed = undefined }
          runs.push(frameKeyPaths(parsed))
          if (result.firstContentMs === null && hasContent(parsed)) result.firstContentMs = elapsed(begin)
        }
      }
      return finish()
    } catch (error) {
      await reader.cancel().catch(() => undefined)
      return finish(failure(error))
    }
  }

  const attempts = [await attempt('current'), await attempt('legacy')]
  return { model, version, meta, attempts, ms: elapsed(started) }
}
