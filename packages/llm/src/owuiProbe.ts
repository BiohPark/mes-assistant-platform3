import { OwuiTerminalCatalog, validTerminalId, type OwuiTerminalFallback, type OwuiTerminalSource } from './owuiTerminals.js'
import { randomUUID } from 'node:crypto'
import type { LlmSettings } from '@mes/domain'
import type { ChatMessageInput } from './provider.js'
import { LimitedFetchError, limitedFetch, toLimitedFetchError } from './limitedFetch.js'
import { parseSseLines } from './sse.js'

/**
 * OpenWebUI 연동 진단(SO 전용, S10-5) — 버전·모델 메타·두 방식의 짧은 시험 호출을 모은다.
 * 결과는 허용 목록 방식이다(S10-5 리뷰): 알려진 이름·형식만 내보내고 나머지는 고정 표기(기타·(가림))로 바꾼다.
 * 오류는 상태 코드 + 고정 분류뿐이며 상위 응답 본문은 읽지 않는다.
 * 일반 채팅 경로(OpenAICompatibleProvider.stream)와 별개다.
 * S13-J: 에이전트 도구·스킬의 서비스 계정 접근 여부와 ③ 세션 방식 시험을 더한다.
 * OpenWebUI는 호출 계정 권한으로 도구(utils/tools.py get_tools 343-385)·스킬(utils/middleware.py 2872-2895, Skills.get_skills(user_id))을 거른다 —
 * 같은 계정으로 GET /api/v1/tools/(routers/tools.py 76-202)·/api/v1/skills/(routers/skills.py 56-72)를 읽어 판정한다.
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
/** ③ 세션 시험 — 채팅 조회 간격·한 번의 조회 상한·정리 호출 시간 */
const SESSION_POLL_MS = 1_000
const SESSION_POLL_TIMEOUT_MS = 15_000
const SESSION_CLEANUP_TIMEOUT_MS = 5_000
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
/** ok = 서비스 계정 목록에 있음, denied = 없음, inactive = 있으나 꺼짐(스킬), unknown = 목록 확인 불가 */
export type OwuiAccessState = 'ok' | 'denied' | 'inactive' | 'unknown'
export interface OwuiProbeAccessList {
  /** 서비스 계정에 보이는 (켜진) 항목 수 — null = 확인 불가 또는 확인 안 함 */
  visible: number | null
  items: { id: string; state: OwuiAccessState }[]
  error?: string
}
/** 서비스 계정 역할·기능 권한 — 이름·이메일·ID는 싣지 않는다. null = 확인 불가 */
export interface OwuiProbeAccount {
  role: 'admin' | 'user' | null
  features: Record<(typeof OWUI_FEATURE_PERMISSIONS)[number], boolean | null>
  error?: string
}
/** fetch_url·search_web 주입 조건 하나 (utils/tools.py 757-765, middleware.py 2452-2456) — ok null = 확인 불가 */
export interface OwuiFetchUrlCondition { name: (typeof OWUI_FETCH_URL_CONDITIONS)[number]; ok: boolean | null }
/** ③ 세션 방식 시험 — 본문·상태 설명은 싣지 않는다 */
export interface OwuiProbeSession {
  /** 채팅 생성 요청의 HTTP 코드 */
  status: number | null
  firstStatusMs: number | null
  doneMs: number | null
  totalMs: number
  /** 상태 action 이름 순서(설명은 버림) — 이름이 없거나 형식 밖이면 기타, 오류 상태는 끝에 `!`, 이어지면 `×N` */
  statuses: string[]
  /** 채팅 삭제 성공 여부 — null = 만든 채팅 없음 */
  cleanup: boolean | null
  error?: string
}
export interface OwuiProbeMeta {
  found: boolean
  toolIds: string[]
  defaultFeatureIds: string[]
  capabilities: Record<string, boolean>
  /** 모델 편집 Builtin Tools 중 명시한 것만 — 없는 항목은 OpenWebUI 기본(켬) */
  builtinTools: Record<string, boolean>
  /** 모델 기본 터미널(meta.terminalId) 설정 여부 — ID는 싣지 않는다. 실제 선택은 terminalSource로 구분한다. */
  terminal: boolean
  terminalSource?: OwuiTerminalSource
  knowledgeCount: number
  functionCalling: string | null
  error?: string
}
export interface OwuiProbeResult {
  model: string
  /** null = 확인 불가 */
  version: string | null
  meta: OwuiProbeMeta
  /** meta.toolIds·skillIds 각각의 서비스 계정 접근 */
  access: { tools: OwuiProbeAccessList; skills: OwuiProbeAccessList }
  account: OwuiProbeAccount
  fetchUrl: OwuiFetchUrlCondition[]
  attempts: OwuiProbeAttempt[]
  session: OwuiProbeSession
  ms: number
}
/** 연결 진단의 접근 확인 — 진단 결과에서 시험 호출·버전을 뺀 것 */
export type OwuiAccessCheck = Pick<OwuiProbeResult, 'model' | 'meta' | 'access' | 'account' | 'fetchUrl' | 'ms'>
export interface OwuiProbeOptions {
  signal?: AbortSignal
  defaultTerminalId?: string | null
  /** 전체 시간 상한 (기본 3분) */
  deadlineMs?: number
  /** 시험 호출 하나의 응답 바이트 상한 (기본 1 MB) */
  maxResponseBytes?: number
  /** ③ 세션 시험의 채팅 조회 간격 (기본 1초) */
  sessionPollMs?: number
}

/** 허용 목록 밖의 값 — 계약(@mes/contracts OwuiProbeResultSchema)과 같은 표기 */
export const OWUI_PROBE_OTHER = '기타'
export const OWUI_PROBE_MASKED = '(가림)'
/** OpenWebUI 모델 편집의 Capabilities 이름 */
export const OWUI_KNOWN_CAPABILITIES = ['vision', 'file_upload', 'file_context', 'web_search', 'image_generation', 'code_interpreter', 'terminal', 'citations', 'status_updates', 'usage', 'builtin_tools'] as const
/** OpenWebUI 모델 편집의 Builtin Tools 이름 (src/lib/components/workspace/Models/BuiltinTools.svelte 12-79) */
export const OWUI_KNOWN_BUILTIN_TOOLS = ['time', 'user_input', 'memory', 'chats', 'notes', 'knowledge', 'files', 'channels', 'notifications', 'web_search',
  'image_generation', 'code_interpreter', 'tasks', 'automations', 'calendar', 'subagents', 'skills'] as const
const FRAME_TOP_KEYS = new Set(['choices', 'sources', 'usage', 'error'])
const FRAME_INNER_KEYS = new Set(['role', 'content', 'reasoning_content', 'reasoning', 'tool_calls', 'function_call', 'refusal'])
const FUNCTION_CALLING = new Set(['native', 'legacy', 'default'])
/** 짧은 식별자(도구 서버 접두 server:·server:mcp: 허용) — 점·슬래시·숫자 시작(IP)·확장자·긴 값은 가린다 */
const SHORT_ID = /^(?:server:(?:mcp:)?)?[A-Za-z_][A-Za-z0-9_-]{0,39}$/
/** 사용자 기능 권한(features.*) 중 기본 도구 주입에 쓰이는 것 */
export const OWUI_FEATURE_PERMISSIONS = ['web_search', 'image_generation', 'code_interpreter'] as const
/** fetch_url 주입 조건 — 이 순서로 표시한다 */
export const OWUI_FETCH_URL_CONDITIONS = ['session_id', 'function_calling', 'builtin_tools', 'builtinTools.web_search', 'web.search.enable',
  'capabilities.web_search', 'features.web_search', 'permission.web_search'] as const
/** 상태 action 이름 — 소문자 식별자만(web_search·tool_connection) */
const STATUS_ACTION = /^[a-z][a-z0-9_]{0,39}$/
/** semver 주.부.수[-접미]만 — 점 4개짜리 IPv4 모양은 통과하지 않는다 */
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[A-Za-z0-9]{1,16})?$/
/** 모델 ID — 영숫자로 시작, 점·콜론·하이픈 허용(glm-5.2·llama3.1:8b). 슬래시·쿼리·호스트/확장자 모양(.영문2자+)·포트 모양·IPv4는 가린다 */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
const HOST_OR_FILE = /\.[A-Za-z]{2,}|:\d{2,5}$|^\d{1,3}(?:\.\d{1,3}){3}/
/** 대표 비밀 접두 — OpenAI·Stripe(sk-/pk-/rk-), GitHub(ghp_·gho_·github_pat_), Slack(xox?-), Bearer, AWS(AKIA), JWT(eyJ) */
const SECRET_PREFIX = /^(?:(?:sk|pk|rk)[-_]|gh[pousr]_|github_pat_|xox[abposr]-|bearer|AKIA|eyJ)/i

/** 식별자 모양의 비밀값 — 대표 접두이거나, 구분자 없는 24자 이상 영숫자 덩어리에 문자와 숫자가 섞였으면 가린다 */
export function looksLikeSecret(value: string): boolean {
  const bare = value.replace(/^server:(?:mcp:)?/, '')
  if (SECRET_PREFIX.test(value) || SECRET_PREFIX.test(bare)) return true
  return (value.match(/[A-Za-z0-9]{24,}/g) ?? []).some((run) => /[A-Za-z]/.test(run) && /\d/.test(run))
}

/** 진단과 실제 전달이 같은 식별자 허용 목록을 사용한다. invalid 항목은 실행 경로에서 제외한다. */
export function owuiMetaIds(value: unknown, apiKey = '', masked = false): string[] {
  return Array.isArray(value) ? value.slice(0, MAX_IDS).flatMap(id =>
    typeof id === 'string' && SHORT_ID.test(id) && !looksLikeSecret(id) && !(apiKey && id.includes(apiKey))
      ? [id] : masked ? [OWUI_PROBE_MASKED] : []) : []
}

/** 모델 편집 기록은 info에서만 읽는다. 진단과 전송 경로의 공통 파싱. */
function modelInfo(entry: unknown): Record<string, unknown> | undefined {
  return isObject(entry) && isObject(entry.info) ? entry.info : undefined
}

/** 세션·도구 전달에 싣는 모델 기본값 — 빈 항목은 싣지 않는다 */
export interface OwuiDefaults { tool_ids?: string[]; skill_ids?: string[]; filter_ids?: string[]; features?: Record<string, true>; terminal_id?: string }
/** 본문에서 모델 기본값을 가려낼 때 쓰는 키 (요청 snapshot) */
export const OWUI_DEFAULT_KEYS = ['tool_ids', 'skill_ids', 'filter_ids', 'features', 'terminal_id'] as const satisfies readonly (keyof OwuiDefaults)[]
/** 기본 기능 중 capability가 켜져 있어야 화면이 켜는 것 (Chat.svelte 1173-1196) */
const DEFAULT_FEATURES = ['web_search', 'image_generation', 'code_interpreter', 'memory'] as const

/**
 * OpenWebUI 화면이 모델을 고를 때 채우는 기본값(Chat.svelte 1117-1206 setDefaults → 4097-4170 요청 본문)을 모델 meta에서 그대로 만든다.
 * 세션 방식·도구 전달·진단이 같은 함수를 쓴다. 사용자 변수·이메일은 싣지 않고, 지식(knowledge)은 OpenWebUI가 모델 meta로 직접 붙인다(utils/tools.py 680-720).
 * - tool_ids ← toolIds, skill_ids ← skillIds(서버도 합친다, middleware.py 2839-2843), filter_ids ← defaultFilterIds(서버가 다시 거른다, utils/filter.py 115-117)
 * - features ← defaultFeatureIds ∩ 켜진 capabilities, 마지막 사용자 메시지에 HTTP(S) URL이 있으면 web_search도 켠다
 * - terminal_id ← 모델 기본값·선택한 터미널, capabilities.terminal이 false가 아닐 때(OWUI 0.12.3 Chat.svelte 1064-1078·1228-1234·4295-4326).
 *   전역 선택·단일 서비스 계정 터미널 폴백은 플랫폼에서 채운다. 터미널 목록은 routers/terminals.py 87-106.
 */
export function owuiDefaults(meta: Record<string, unknown> | undefined, apiKey = '', messages: readonly ChatMessageInput[] = [], fallback: OwuiTerminalFallback = {}): OwuiDefaults {
  const ids = (value: unknown) => [...new Set(owuiMetaIds(value, apiKey))]
  const capabilities = isObject(meta?.capabilities) ? meta.capabilities : {}
  const featureIds = ids(meta?.defaultFeatureIds)
  const features = Object.fromEntries(DEFAULT_FEATURES.filter((id) => featureIds.includes(id) && capabilities[id] === true).map((id) => [id, true as const]))
  const userText = messages.findLast((message) => message.role === 'user')?.content ?? ''
  if (capabilities.web_search === true && /https?:\/\/[^\s<>"'`)\]]+/i.test(userText)) features.web_search = true
  const terminalId = owuiTerminal(meta, fallback).id
  // MessageInput.svelte 903-906: 터미널과 기존 코드 인터프리터는 함께 켜지 않는다.
  if (terminalId) delete features.code_interpreter
  const list = (key: 'tool_ids' | 'skill_ids' | 'filter_ids', value: string[]) => value.length ? { [key]: value } : {}
  return { ...list('tool_ids', ids(meta?.toolIds)), ...list('skill_ids', ids(meta?.skillIds)), ...list('filter_ids', ids(meta?.defaultFilterIds)),
    ...(Object.keys(features).length ? { features } : {}),
    ...(terminalId ? { terminal_id: terminalId } : {}) }
}

/** 모델 기본값 → 플랫폼 전역 선택 → 정확히 한 개의 서비스 계정 터미널. OWUI처럼 알려진 목록에 없는 선택은 보내지 않는다. */
export function owuiTerminal(meta: Record<string, unknown> | undefined, fallback: OwuiTerminalFallback = {}): { id: string | undefined; source: OwuiTerminalSource } {
  const none = { id: undefined, source: 'none' as const }
  if (isObject(meta?.capabilities) && meta.capabilities.terminal === false) return none
  const available = (id: unknown): id is string => validTerminalId(id) && (fallback.terminals === undefined || fallback.terminals.some(item => item.id === id))
  if (available(meta?.terminalId)) return { id: meta.terminalId, source: 'model' }
  if (fallback.defaultTerminalId) return available(fallback.defaultTerminalId) ? { id: fallback.defaultTerminalId, source: 'global' } : none
  const only = fallback.terminals?.length === 1 ? fallback.terminals[0]?.id : undefined
  return available(only) ? { id: only, source: 'single' } : none
}

/** /api/models의 해당 모델 info.meta로 기본값을 만든다. */
export function owuiModelTools(body: unknown, model: string, apiKey = '', messages: readonly ChatMessageInput[] = [], fallback: OwuiTerminalFallback = {}): OwuiDefaults {
  const entry = isObject(body) && Array.isArray(body.data) ? body.data.find(item => isObject(item) && item.id === model) : undefined
  const info = modelInfo(entry)
  return owuiDefaults(info && isObject(info.meta) ? info.meta : undefined, apiKey, messages, fallback)
}

/** 입력 모델이 OpenWebUI 모델 목록에 없다 — 시험 호출 전에 멈춘다(API 400) */
export class OwuiProbeUnknownModelError extends Error {
  constructor() { super('모델 목록에 없는 모델입니다'); this.name = 'OwuiProbeUnknownModelError' }
}
const safeModel = (model: string) => MODEL_ID.test(model) && !HOST_OR_FILE.test(model) && !looksLikeSecret(model) ? model : OWUI_PROBE_MASKED
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
const knownFlags = (value: unknown, names: readonly string[]): Record<string, boolean> =>
  isObject(value) ? Object.fromEntries(names.filter((name) => typeof value[name] === 'boolean').map((name) => [name, value[name] as boolean])) : {}
/** 상태 항목 하나의 이름 — 설명(description)은 URL·검색어를 담을 수 있어 보지 않는다 */
function statusName(item: unknown): string {
  const action = isObject(item) && typeof item.action === 'string' && STATUS_ACTION.test(item.action) && !looksLikeSecret(item.action) ? item.action : OWUI_PROBE_OTHER
  return isObject(item) && item.error === true ? `${action}!` : action
}
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return }
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

/** 진단 공통 — 전체 시간 상한 안의 GET, 오류는 상태 코드·고정 분류로만 */
function probeClient(settings: LlmSettings, options: OwuiProbeOptions) {
  const started = performance.now()
  const deadline = started + (options.deadlineMs ?? DEADLINE_MS)
  const remaining = (cap: number) => Math.min(cap, Math.max(0, Math.floor(deadline - performance.now())))
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`
  const failure = (error: unknown) => toLimitedFetchError(error).message
  // LimitedFetchError는 고정 문구, 그 밖은 httpError의 고정 분류나 '응답 형식 오류'뿐
  const classify = (error: unknown) => error instanceof LimitedFetchError || !(error instanceof Error) ? failure(error) : error.message
  async function getJson(url: string, cap: number, maxResponseBytes: number): Promise<unknown> {
    const timeoutMs = remaining(cap)
    if (timeoutMs <= 0) throw new LimitedFetchError('timeout')
    const res = await limitedFetch(url, { headers }, { timeoutMs, maxResponseBytes, signal: options.signal })
    if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw new Error(httpError(res.status)) }
    // JSON 파서 오류 문구는 본문 일부를 인용할 수 있다 — 고정 문구로 바꾼다
    try { return await res.json() } catch (error) { throw error instanceof LimitedFetchError ? error : new Error('응답 형식 오류') }
  }
  return { started, remaining, headers, failure, classify, getJson, signal: options.signal }
}
type ProbeClient = ReturnType<typeof probeClient>

/** 모델 메타·도구·스킬 접근·서비스 계정 — 읽기만 하고 모델은 부르지 않는다 */
const probeTerminals = new OwuiTerminalCatalog()
async function readModelAccess(settings: LlmSettings, model: string, { classify, getJson, signal, remaining }: ProbeClient) {
  const meta: OwuiProbeMeta = { found: false, toolIds: [], defaultFeatureIds: [], capabilities: {}, builtinTools: {}, terminal: false, knowledgeCount: 0, functionCalling: null }
  let data: unknown[] | undefined
  try {
    const body = await getJson(joinUrl(settings.baseUrl, 'models'), MODELS_TIMEOUT_MS, MODELS_MAX_BYTES)
    data = isObject(body) && Array.isArray(body.data) ? body.data : []
  } catch (error) { meta.error = classify(error) }
  // 목록을 읽었으면 그 안의 id만 받는다 — 못 읽었으면 진단은 계속하되 결과의 모델 표기는 형식 검사로 가린다
  const entry: unknown = data?.find((item) => isObject(item) && item.id === model)
  if (data && entry === undefined) throw new OwuiProbeUnknownModelError()
  const info = modelInfo(entry)
  const raw = info && isObject(info.meta) ? info.meta : undefined
  if (info) {
    meta.found = true
    // 개수는 그대로 — 형식에 맞지 않는 항목은 (가림)으로 바꾼다
    const ids = (value: unknown) => owuiMetaIds(value, settings.apiKey, true)
    meta.toolIds = ids(raw?.toolIds)
    meta.defaultFeatureIds = ids(raw?.defaultFeatureIds)
    meta.capabilities = knownFlags(raw?.capabilities, OWUI_KNOWN_CAPABILITIES)
    meta.builtinTools = knownFlags(raw?.builtinTools, OWUI_KNOWN_BUILTIN_TOOLS)
    meta.terminal = typeof raw?.terminalId === 'string' && raw.terminalId.length > 0
    meta.knowledgeCount = Array.isArray(raw?.knowledge) ? raw.knowledge.length : 0
    // OpenWebUI는 function_calling을 info.params에 둔다(옛 기록 대비 meta.params도 본다)
    const params = isObject(info.params) ? info.params : isObject(raw?.params) ? raw.params : undefined
    const fc = params?.function_calling
    meta.functionCalling = typeof fc === 'string' ? (FUNCTION_CALLING.has(fc) ? fc : OWUI_PROBE_OTHER) : null
  }

  /** 서비스 계정이 보는 목록과 대조한다 — 표시는 같은 허용 목록((가림)), 대조는 원래 ID로. 이름·설명은 읽지 않는다 */
  async function accessList(path: string, value: unknown): Promise<OwuiProbeAccessList> {
    const raw = Array.isArray(value) ? value.slice(0, MAX_IDS) : []
    const shown = owuiMetaIds(raw, settings.apiKey, true)
    let active: Map<string, boolean> | undefined
    let error: string | undefined
    try {
      const body = await getJson(joinUrl(settings.baseUrl, path), MODELS_TIMEOUT_MS, MODELS_MAX_BYTES)
      if (!Array.isArray(body)) throw new Error('응답 형식 오류')
      // 스킬은 is_active=false면 OpenWebUI가 쓰지 않는다(middleware.py 2891-2894). 도구에는 이 필드가 없다
      active = new Map(body.filter(isObject).filter((item) => typeof item.id === 'string').map((item) => [item.id as string, item.is_active !== false]))
    } catch (failed) { error = classify(failed) }
    const items = raw.map((id, index) => ({ id: shown[index]!,
      state: (!active ? 'unknown' : typeof id === 'string' && active.has(id) ? active.get(id) ? 'ok' : 'inactive' : 'denied') as OwuiAccessState }))
    return { visible: active ? [...active.values()].filter(Boolean).length : null, items, ...(error ? { error } : {}) }
  }
  const access = info
    ? { tools: await accessList('v1/tools/', raw?.toolIds), skills: await accessList('v1/skills/', raw?.skillIds) }
    : { tools: { visible: null, items: [] }, skills: { visible: null, items: [] } }

  // 서비스 계정 역할·기능 권한 — /api/v1/auths/는 사람 세션 전용(utils/auth.py 763-766, API 키는 403)이고 토큰·이름·이메일을 돌려주므로 쓰지 않는다.
  // 권한은 GET /api/v1/users/permissions(routers/users.py 181-189), 역할은 관리자 전용 GET /api/v1/users/default/permissions의
  // 성공(admin)·401(get_admin_user, utils/auth.py 622-628 → user)로 가린다. 그 밖(403 키 경로 제한 등)은 확인 불가. 응답에서는 불린만 읽는다.
  const account: OwuiProbeAccount = { role: null, features: { web_search: null, image_generation: null, code_interpreter: null } }
  let permissionsRead = false
  try {
    const body = await getJson(joinUrl(settings.baseUrl, 'v1/users/permissions'), MODELS_TIMEOUT_MS, SMALL_MAX_BYTES)
    const features = isObject(body) && isObject(body.features) ? body.features : {}
    for (const name of OWUI_FEATURE_PERMISSIONS) account.features[name] = typeof features[name] === 'boolean' ? features[name] : null
    permissionsRead = true
  } catch (error) { account.error = classify(error) }
  try {
    await getJson(joinUrl(settings.baseUrl, 'v1/users/default/permissions'), MODELS_TIMEOUT_MS, SMALL_MAX_BYTES)
    account.role = 'admin'
  } catch (error) { if (permissionsRead && error instanceof Error && error.message === httpError(401)) account.role = 'user' }

  let terminals
  const terminalTimeoutMs = remaining(10_000)
  if (terminalTimeoutMs > 0) {
    try { terminals = await probeTerminals.list(settings, signal, terminalTimeoutMs) } catch { /* 목록 실패: 명시한 기본값은 유지하고 단일 자동 선택은 하지 않는다. */ }
  }
  return { meta, info, raw, access, account, terminals }
}

/** fetch_url·search_web 주입 조건 — session은 ③ 세션 시험 결과(없으면 session_id 항목을 뺀다) */
function fetchUrlConditions(found: boolean, meta: OwuiProbeMeta, account: OwuiProbeAccount, session?: OwuiProbeSession): OwuiFetchUrlCondition[] {
  // 모델 설정 항목은 없으면 OpenWebUI 기본(켬·native)이다. 전역 web.search.enable은 API 키로 읽을 곳이 없다(/api/config는 JWT 사용자에게만, main.py 2280-2290·2404-2455)
  const modelFlag = (value: boolean | undefined) => found ? value !== false : null
  const ok: Record<OwuiFetchUrlCondition['name'], boolean | null> = {
    session_id: session ? session.cleanup !== null ? true : session.status !== null ? false : null : null,
    function_calling: found ? meta.functionCalling !== 'legacy' : null,
    builtin_tools: modelFlag(meta.capabilities.builtin_tools),
    'builtinTools.web_search': modelFlag(meta.builtinTools.web_search),
    'web.search.enable': null,
    'capabilities.web_search': modelFlag(meta.capabilities.web_search),
    // 진단 질문의 기본값이 아니라, URL이 있는 실제 요청에서 자동으로 켤 수 있는지 표시한다.
    'features.web_search': meta.capabilities.web_search === true,
    // has_user_permission: 관리자는 항상 통과(utils/tools.py 638-645)
    'permission.web_search': account.role === 'admin' || account.features.web_search === true ? true : account.role === 'user' ? account.features.web_search : null,
  }
  return OWUI_FETCH_URL_CONDITIONS.filter((name) => session || name !== 'session_id').map((name) => ({ name, ok: ok[name] }))
}

/** 연결 진단의 접근 확인(S13-J) — 진단에서 시험 호출(①②③)과 버전 조회를 뺀 읽기 전용 확인 */
export async function checkOpenWebUiAccess(settings: LlmSettings, model: string, options: OwuiProbeOptions = {}): Promise<OwuiAccessCheck> {
  const client = probeClient(settings, options)
  const { meta, info, raw, access, account, terminals } = await readModelAccess(settings, model, client)
  meta.terminalSource = owuiTerminal(raw, { terminals, defaultTerminalId: options.defaultTerminalId }).source
  return { model: safeModel(model), meta, access, account, fetchUrl: fetchUrlConditions(!!info, meta, account), ms: elapsed(client.started) }
}

export async function probeOpenWebUi(settings: LlmSettings, model: string, options: OwuiProbeOptions = {}): Promise<OwuiProbeResult> {
  const client = probeClient(settings, options)
  const { started, remaining, headers, failure, classify, getJson } = client
  let version: string | null = null
  try {
    const body = await getJson(joinUrl(rootUrl(settings.baseUrl), 'api/version'), VERSION_TIMEOUT_MS, SMALL_MAX_BYTES)
    const value = isObject(body) ? body.version : undefined
    if (typeof value === 'string' && VERSION.test(value) && !looksLikeSecret(value)) version = value
  } catch { /* 확인 불가 */ }

  const { meta, info, raw, access, account, terminals } = await readModelAccess(settings, model, client)
  meta.terminalSource = owuiTerminal(raw, { terminals, defaultTerminalId: options.defaultTerminalId }).source

  const messages = [{ role: 'user', content: OWUI_PROBE_PROMPT }]
  // ②·③은 실제 대화 요청과 같은 모델 기본값을 싣는다
  const defaults = owuiDefaults(raw, settings.apiKey, [], { terminals, defaultTerminalId: options.defaultTerminalId })
  const bodies: Record<OwuiProbeMode, Record<string, unknown>> = {
    current: { model, messages, stream: true },
    legacy: { model, messages, stream: true, ...defaults, params: { function_calling: 'legacy' } },
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

  /**
   * ③ 세션 방식 — 대화 요청(OpenAICompatibleProvider.streamSession)과 같은 본문으로 백그라운드 채팅을 만들고 채팅 GET을 폴링한다.
   * session_id가 있어야 OpenWebUI가 기본 도구·스킬을 붙인다(middleware.py 2452-2456). 끝나면 중지(미완료 시)·삭제하고 삭제 성공만 남긴다.
   */
  async function sessionAttempt(): Promise<OwuiProbeSession> {
    const begin = performance.now()
    const result: OwuiProbeSession = { status: null, firstStatusMs: null, doneMs: null, totalMs: 0, statuses: [], cleanup: null }
    const runs = new FrameRuns()
    let chatId: string | undefined
    let finished = false
    const call = async (method: 'POST' | 'DELETE', path: string) => {
      try {
        const res = await limitedFetch(joinUrl(settings.baseUrl, path), { method, headers }, { timeoutMs: SESSION_CLEANUP_TIMEOUT_MS })
        await res.body?.cancel().catch(() => undefined)
        return res.ok
      } catch { return false }
    }
    const finish = async (error?: string) => {
      // 취소·시간 초과여도 정리는 한다 — 정리 호출은 바깥 신호와 무관한 짧은 상한을 쓴다
      if (chatId) {
        if (!finished) await call('POST', `tasks/chat/${encodeURIComponent(chatId)}/stop`)
        result.cleanup = await call('DELETE', `v1/chats/${encodeURIComponent(chatId)}`)
      }
      result.totalMs = elapsed(begin)
      result.statuses = runs.list()
      if (error) result.error = error
      return result
    }
    const timeoutMs = remaining(ATTEMPT_TIMEOUT_MS)
    if (timeoutMs <= 0) return finish(new LimitedFetchError('timeout').message)
    const until = performance.now() + timeoutMs
    const messageId = randomUUID()
    const body = { model, messages, stream: true, ...defaults,
      session_id: `mes-probe-${randomUUID()}`, id: messageId, parent_id: null, params: { tool_approval_mode: 'full' } }
    let res: Response
    try {
      res = await limitedFetch(joinUrl(settings.baseUrl, 'chat/completions'), { method: 'POST', headers, body: JSON.stringify(body) },
        { timeoutMs, maxResponseBytes: SMALL_MAX_BYTES, signal: options.signal })
    } catch (error) { return finish(failure(error)) }
    result.status = res.status
    if (!res.ok || !res.body) { await res.body?.cancel().catch(() => undefined); return finish(httpError(res.status)) }
    // 세션을 모르는 OpenWebUI는 스트리밍으로 답한다 — 읽지 않고 끊는다
    if (res.headers.get('content-type')?.includes('text/event-stream')) { await res.body.cancel().catch(() => undefined); return finish('세션 미지원') }
    let created: unknown
    try { created = await res.json() } catch (error) { return finish(error instanceof LimitedFetchError ? error.message : '응답 형식 오류') }
    chatId = isObject(created) && typeof created.chat_id === 'string' && created.chat_id ? created.chat_id : undefined
    if (!chatId) return finish('응답 형식 오류')
    const chatPath = `v1/chats/${encodeURIComponent(chatId)}`
    let seenStatuses = 0
    while (true) {
      if (options.signal?.aborted) return finish(new LimitedFetchError('aborted').message)
      const left = Math.floor(until - performance.now())
      if (left <= 0) return finish(new LimitedFetchError('timeout').message)
      let message: Record<string, unknown> | undefined
      try {
        const chat = await getJson(joinUrl(settings.baseUrl, chatPath), Math.min(SESSION_POLL_TIMEOUT_MS, left), MODELS_MAX_BYTES)
        const messages = isObject(chat) && isObject(chat.chat) && isObject(chat.chat.history) ? chat.chat.history.messages : undefined
        if (!isObject(messages)) throw new Error('응답 형식 오류')
        message = isObject(messages[messageId]) ? messages[messageId] : undefined
      } catch (error) { return finish(classify(error)) }
      if (message) {
        const history = Array.isArray(message.statusHistory) ? message.statusHistory : []
        if (history.length > seenStatuses) {
          result.firstStatusMs ??= elapsed(begin)
          for (const item of history.slice(seenStatuses)) runs.push(statusName(item))
          seenStatuses = history.length
        }
        if (message.error !== undefined && message.error !== null && message.error !== false) { finished = true; return finish('작업 실패') }
        if (message.done === true) { finished = true; result.doneMs = elapsed(begin); return finish() }
      }
      await sleep(Math.min(options.sessionPollMs ?? SESSION_POLL_MS, left), options.signal)
    }
  }

  const attempts = [await attempt('current'), await attempt('legacy')]
  const session = await sessionAttempt()
  const fetchUrl = fetchUrlConditions(!!info, meta, account, session)
  return { model: safeModel(model), version, meta, access, account, fetchUrl, attempts, session, ms: elapsed(started) }
}
