import type { LlmSettings } from '@mes/domain'
import { LimitedFetchError, limitedFetch, toLimitedFetchError } from './limitedFetch.js'
import { parseSseLines } from './sse.js'

/**
 * OpenWebUI 연동 진단(SO 전용, S10-5) — 버전·모델 메타·두 방식의 짧은 시험 호출을 모은다.
 * 결과에는 프롬프트·답변 본문·파일·키·주소를 넣지 않는다: 프레임은 키 경로만, 오류는 가린 뒤 120자.
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
const ERROR_BODY_CHARS = 4096
const MAX_RUNS = 40
const MAX_IDS = 20
const ERROR_MAX = 120
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

const SAFE_KEY = /^[A-Za-z0-9_-]{1,40}$/
const SAFE_ID = /^[\w.:-]{1,64}$/
const elapsed = (started: number) => Math.round(performance.now() - started)
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isEmpty = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
const safeKey = (key: string) => SAFE_KEY.test(key) ? key : '?'

/** 주소·IP·호스트·비밀값을 가리고 공백을 접어 120자로 자른다 */
export function maskProbeError(text: string, secrets: string[]): string {
  let masked = secrets.filter(Boolean).reduce((value, secret) => value.replaceAll(secret, '[redacted]'), text)
  masked = masked
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '[host]')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\b/gi, '[host]')
    .replace(/\s+/g, ' ')
    .trim()
  return masked.slice(0, ERROR_MAX)
}

/** 프레임 하나의 키 경로 — 값은 보지 않고 비어 있지 않은 필드 이름만 */
export function frameKeyPaths(frame: unknown): string {
  if (!isObject(frame)) return 'non-json'
  const paths: string[] = []
  for (const [key, value] of Object.entries(frame)) {
    if (ENVELOPE.has(key) || isEmpty(value)) continue
    const choice = key === 'choices' && Array.isArray(value) ? value[0] : undefined
    if (!isObject(choice)) { paths.push(safeKey(key)); continue }
    const inner: string[] = []
    for (const part of ['delta', 'message'] as const) {
      const body = choice[part]
      if (isObject(body)) inner.push(...Object.entries(body).filter(([, v]) => !isEmpty(v)).map(([k]) => `choices.${part}.${safeKey(k)}`))
    }
    if (!isEmpty(choice.finish_reason)) inner.push('choices.finish_reason')
    paths.push(...(inner.length ? inner : [isObject(choice.delta) ? 'choices.delta' : 'choices']))
  }
  return paths.length ? paths.join('+') : 'empty'
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

/** 상위 오류 본문에서 사람이 읽을 문구만 꺼낸다(JSON detail·error·message). 못 꺼내면 빈 문자열 */
function errorDetail(text: string): string {
  try {
    const body: unknown = JSON.parse(text.slice(0, ERROR_BODY_CHARS))
    if (!isObject(body)) return ''
    const pick = (value: unknown): string => typeof value === 'string' ? value
      : Array.isArray(value) ? value.map((item) => isObject(item) && typeof item.msg === 'string' ? item.msg : '').filter(Boolean).join('; ')
        : isObject(value) && typeof value.message === 'string' ? value.message : ''
    return pick(body.detail) || pick(body.error) || pick(body.message)
  } catch { return '' }
}

export async function probeOpenWebUi(settings: LlmSettings, model: string, options: OwuiProbeOptions = {}): Promise<OwuiProbeResult> {
  const started = performance.now()
  const deadline = started + (options.deadlineMs ?? DEADLINE_MS)
  const remaining = (cap: number) => Math.min(cap, Math.max(0, Math.floor(deadline - performance.now())))
  const secrets = [settings.apiKey, OWUI_PROBE_PROMPT]
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`
  const failure = (error: unknown) => toLimitedFetchError(error).message
  const httpError = async (res: Response) => {
    const text = await res.text().catch(() => '')
    const detail = maskProbeError(errorDetail(text), secrets)
    return maskProbeError(detail ? `HTTP ${res.status} · ${detail}` : `HTTP ${res.status}`, [])
  }
  async function getJson(url: string, cap: number, maxResponseBytes: number): Promise<unknown> {
    const timeoutMs = remaining(cap)
    if (timeoutMs <= 0) throw new LimitedFetchError('timeout')
    const res = await limitedFetch(url, { headers }, { timeoutMs, maxResponseBytes, signal: options.signal })
    if (!res.ok) throw new Error(await httpError(res))
    // JSON 파서 오류 문구는 본문 일부를 인용할 수 있다 — 고정 문구로 바꾼다
    try { return await res.json() } catch (error) { throw error instanceof LimitedFetchError ? error : new Error('응답 형식 오류') }
  }

  let version: string | null = null
  try {
    const body = await getJson(joinUrl(rootUrl(settings.baseUrl), 'api/version'), VERSION_TIMEOUT_MS, SMALL_MAX_BYTES)
    const value = isObject(body) ? body.version : undefined
    if (typeof value === 'string' && /^[\w.+-]{1,40}$/.test(value)) version = value
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
      const ids = (value: unknown) => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').map((id) => SAFE_ID.test(id) ? id : '?').slice(0, MAX_IDS) : []
      meta.toolIds = ids(raw?.toolIds)
      meta.defaultFeatureIds = ids(raw?.defaultFeatureIds)
      if (isObject(raw?.capabilities)) {
        meta.capabilities = Object.fromEntries(Object.entries(raw.capabilities).filter(([key, value]) => SAFE_KEY.test(key) && typeof value === 'boolean').slice(0, MAX_IDS)) as Record<string, boolean>
      }
      meta.knowledgeCount = Array.isArray(raw?.knowledge) ? raw.knowledge.length : 0
      // OpenWebUI는 function_calling을 info.params에 둔다(옛 기록 대비 meta.params도 본다)
      const params = isObject(info.params) ? info.params : isObject(raw?.params) ? raw.params : undefined
      const fc = params?.function_calling
      meta.functionCalling = typeof fc === 'string' ? (SAFE_KEY.test(fc) ? fc : '?') : null
    }
  } catch (error) {
    // LimitedFetchError는 고정 문구, 그 밖은 httpError가 이미 가린 문구나 '응답 형식 오류'뿐
    meta.error = error instanceof LimitedFetchError || !(error instanceof Error) ? failure(error) : maskProbeError(error.message, secrets)
  }

  const messages = [{ role: 'user', content: OWUI_PROBE_PROMPT }]
  const bodies: Record<OwuiProbeMode, Record<string, unknown>> = {
    current: { model, messages, stream: true },
    legacy: { model, messages, stream: true, tool_ids: meta.toolIds.filter((id) => id !== '?'),
      features: Object.fromEntries(meta.defaultFeatureIds.filter((id) => id !== '?').map((id) => [id, true])), params: { function_calling: 'legacy' } },
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
      try { return finish(await httpError(res)) } catch (error) { return finish(failure(error)) }
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
