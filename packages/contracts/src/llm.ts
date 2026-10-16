import { z } from 'zod'

export const LlmModelsSchema = z.object({ models: z.array(z.string()) })
export const LlmStatusSchema = z.object({
  mode: z.enum(['mock', 'live']),
  preset: z.enum(['openwebui', 'openai-compatible']),
  baseUrlHost: z.string(),
  ok: z.boolean(),
  detail: z.string(),
})

/** 모델 ID — 공백 제거, 제어 문자 없음, 191자 이하 */
export const LlmModelIdSchema = z.string().trim().min(1).max(191).regex(/^\P{Cc}+$/u, '모델 ID에 제어 문자를 쓸 수 없습니다')

/** POST /admin/llm/test 요청 — 업무 맥락 없이 모델에 직접 보낸다 (SO 전용, 저장 없음) */
/** 메시지당 상한은 시험 응답 상한(64 KB)과 같게 — 긴 답을 받은 다음 턴이 형식 오류가 되지 않게. 총량은 requestBudgetBytes(413)가 막는다 */
export const LlmTestMessageSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(65_536) }).strict()
export const LlmTestRequestSchema = z.object({ model: LlmModelIdSchema.optional(), messages: z.array(LlmTestMessageSchema).min(1).max(20) }).strict()
export const LlmTestResultSchema = z.object({ text: z.string(), model: z.string(), ms: z.number() })
export type LlmTestMessage = z.infer<typeof LlmTestMessageSchema>
export type LlmTestRequest = z.infer<typeof LlmTestRequestSchema>
export type LlmTestResult = z.infer<typeof LlmTestResultSchema>

/** 시험 실패 분류 — 웹이 상태 코드와 함께 안내 문구를 고른다 */
export const LlmTestErrorCodeSchema = z.enum(['TIMEOUT', 'RESPONSE_TOO_LARGE', 'MODEL_NOT_FOUND', 'PROVIDER_ERROR'])
export type LlmTestErrorCode = z.infer<typeof LlmTestErrorCodeSchema>

/** POST /admin/llm/test-connection 결과 — 목록 조회와 짧은 응답 호출을 각각 보고 */
export const LlmTestConnectionSchema = z.object({
  models: z.object({ ok: z.boolean(), count: z.number(), ms: z.number(), error: z.string().optional() }),
  completion: z.object({ ok: z.boolean(), ms: z.number(), model: z.string(), error: z.string().optional() }),
})
export type LlmTestConnection = z.infer<typeof LlmTestConnectionSchema>

/** POST /admin/diagnostics/openwebui — SO 전용 OpenWebUI 진단(S10-5). 입력은 모델 하나 */
export const OwuiProbeRequestSchema = z.object({ model: LlmModelIdSchema }).strict()
/**
 * 결과는 허용 목록으로만 이뤄진다(S10-5 리뷰) — @mes/llm owuiProbe와 같은 목록. 서버 응답과 웹 파싱 양쪽에서 검사해
 * 목록 밖 값(키·주소·파일명·본문)이 새로 섞이면 통과하지 못한다.
 */
export const OWUI_PROBE_OTHER = '기타'
export const OWUI_PROBE_MASKED = '(가림)'
const OWUI_CAPABILITIES = ['vision', 'file_upload', 'file_context', 'web_search', 'image_generation', 'code_interpreter', 'terminal', 'citations', 'status_updates', 'usage', 'builtin_tools'] as const
const OWUI_BUILTIN_TOOLS = ['time', 'user_input', 'memory', 'chats', 'notes', 'knowledge', 'files', 'channels', 'notifications', 'web_search',
  'image_generation', 'code_interpreter', 'tasks', 'automations', 'calendar', 'subagents', 'skills'] as const
const FRAME_TOKEN = '(?:choices(?:\\.(?:delta|message)(?:\\.(?:role|content|reasoning_content|reasoning|tool_calls|function_call|refusal|기타))?|\\.finish_reason)?|sources|usage|error|기타|non-json|empty|\\[DONE\\])'
const FRAME = new RegExp(`^(?:${FRAME_TOKEN}(?:\\+${FRAME_TOKEN})*(?: ×\\d+)?|…)$`)
const SECRET_PREFIX = /^(?:(?:sk|pk|rk)[-_]|gh[pousr]_|github_pat_|xox[abposr]-|bearer|AKIA|eyJ)/i
/** 식별자 모양의 비밀값 — 대표 접두이거나 구분자 없는 24자 이상 영숫자 덩어리에 문자·숫자가 섞임 (@mes/llm looksLikeSecret과 같은 규칙) */
const looksLikeSecret = (value: string) => SECRET_PREFIX.test(value) || SECRET_PREFIX.test(value.replace(/^server:(?:mcp:)?/, ''))
  || (value.match(/[A-Za-z0-9]{24,}/g) ?? []).some((run) => /[A-Za-z]/.test(run) && /\d/.test(run))
const notSecret = (schema: z.ZodString) => schema.refine((value) => !looksLikeSecret(value))
const PROBE_ID = /^(?:(?:server:(?:mcp:)?)?[A-Za-z_][A-Za-z0-9_-]{0,39}|\(가림\))$/
const PROBE_MODEL = /^(?:[A-Za-z0-9][A-Za-z0-9._:-]{0,63}|\(가림\))$/
const HOST_OR_FILE = /\.[A-Za-z]{2,}|:\d{2,5}$|^\d{1,3}(?:\.\d{1,3}){3}/
const PROBE_ERROR = /^(?:HTTP \d{3} · (?:형식 거부|인증 거부|찾을 수 없음|크기 거부|요청 제한|서버 오류|거부)|응답 시간 초과|리다이렉트 응답은 허용하지 않습니다|응답 크기 한도 초과|요청이 취소되었습니다\.|LLM 서비스 연결 오류|응답 형식 오류)$/
/** ③ 세션 시험에만 있는 고정 분류 */
const SESSION_ERROR = /^(?:세션 미지원|작업 실패)$/
/** 세션 상태 이름 — 소문자 action 식별자 또는 기타, 오류 표시 `!`, 접기 `×N` */
const SESSION_STATUS = /^(?:(?:[a-z][a-z0-9_]{0,39}|기타)!?(?: ×\d+)?|…)$/
export const OwuiProbeAttemptSchema = z.object({
  mode: z.enum(['current', 'legacy']),
  status: z.number().int().nullable(),
  firstByteMs: z.number().nullable(),
  firstContentMs: z.number().nullable(),
  totalMs: z.number(),
  frames: z.array(z.string().regex(FRAME)).max(41),
  error: z.string().regex(PROBE_ERROR).optional(),
})
/** 서비스 계정 접근(S13-J) — ok 목록에 있음 · denied 없음 · inactive 꺼짐(스킬) · unknown 목록 확인 불가 */
export const OwuiProbeAccessListSchema = z.object({
  visible: z.number().int().nullable(),
  items: z.array(z.object({ id: notSecret(z.string().regex(PROBE_ID)), state: z.enum(['ok', 'denied', 'inactive', 'unknown']) })).max(20),
  error: z.string().regex(PROBE_ERROR).optional(),
})
/** ③ 세션 방식 시험(S13-J) — 결과 코드·시간·상태 이름·정리 여부만 */
export const OwuiProbeSessionSchema = z.object({
  status: z.number().int().nullable(),
  firstStatusMs: z.number().nullable(),
  doneMs: z.number().nullable(),
  totalMs: z.number(),
  statuses: z.array(notSecret(z.string().regex(SESSION_STATUS))).max(41),
  cleanup: z.boolean().nullable(),
  error: z.string().refine((value) => PROBE_ERROR.test(value) || SESSION_ERROR.test(value)).optional(),
})
/** 서비스 계정 역할·기능 권한(S13-J) — 이름·이메일·ID는 담지 않는다 */
export const OwuiProbeAccountSchema = z.object({
  role: z.enum(['admin', 'user']).nullable(),
  features: z.object({ web_search: z.boolean().nullable(), image_generation: z.boolean().nullable(), code_interpreter: z.boolean().nullable() }),
  error: z.string().regex(PROBE_ERROR).optional(),
})
/** fetch_url 주입 조건 — @mes/llm OWUI_FETCH_URL_CONDITIONS와 같은 이름 */
export const OWUI_FETCH_URL_CONDITIONS = ['session_id', 'function_calling', 'builtin_tools', 'builtinTools.web_search', 'web.search.enable',
  'capabilities.web_search', 'features.web_search', 'permission.web_search'] as const
export const OwuiFetchUrlConditionSchema = z.object({ name: z.enum(OWUI_FETCH_URL_CONDITIONS), ok: z.boolean().nullable() })
export const OwuiProbeResultSchema = z.object({
  model: notSecret(z.string().regex(PROBE_MODEL)).refine((value) => !HOST_OR_FILE.test(value)),
  version: notSecret(z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[A-Za-z0-9]{1,16})?$/)).nullable(),
  meta: z.object({
    found: z.boolean(),
    toolIds: z.array(notSecret(z.string().regex(PROBE_ID))).max(20),
    defaultFeatureIds: z.array(notSecret(z.string().regex(PROBE_ID))).max(20),
    capabilities: z.partialRecord(z.enum(OWUI_CAPABILITIES), z.boolean()),
    builtinTools: z.partialRecord(z.enum(OWUI_BUILTIN_TOOLS), z.boolean()),
    /** 모델 기본 터미널 설정 여부 — ID는 담지 않는다 */
    terminal: z.boolean(),
    knowledgeCount: z.number().int(),
    functionCalling: z.enum(['native', 'legacy', 'default', '기타']).nullable(),
    error: z.string().regex(PROBE_ERROR).optional(),
  }),
  access: z.object({ tools: OwuiProbeAccessListSchema, skills: OwuiProbeAccessListSchema }),
  account: OwuiProbeAccountSchema,
  fetchUrl: z.array(OwuiFetchUrlConditionSchema).max(OWUI_FETCH_URL_CONDITIONS.length),
  attempts: z.array(OwuiProbeAttemptSchema).max(2),
  session: OwuiProbeSessionSchema,
  ms: z.number(),
})
/** POST /admin/diagnostics/openwebui/access — 에이전트 편집의 연결 확인(S13-J). 진단 결과에서 시험 호출·버전을 뺀 것 */
export const OwuiAccessCheckSchema = OwuiProbeResultSchema.pick({ model: true, meta: true, access: true, account: true, fetchUrl: true, ms: true })
export type OwuiAccessCheck = z.infer<typeof OwuiAccessCheckSchema>
export type OwuiProbeRequest = z.infer<typeof OwuiProbeRequestSchema>
export type OwuiProbeAttemptResult = z.infer<typeof OwuiProbeAttemptSchema>
export type OwuiProbeReport = z.infer<typeof OwuiProbeResultSchema>
export type OwuiProbeAccessListResult = z.infer<typeof OwuiProbeAccessListSchema>
export type OwuiProbeSessionResult = z.infer<typeof OwuiProbeSessionSchema>
export type OwuiProbeAccountResult = z.infer<typeof OwuiProbeAccountSchema>

/** URL 자동 읽기 정책 — 도메인(하위 도메인 포함)만 받는다. URL·포트·와일드카드는 거부한다. */
export const UrlDomainSchema = z.string().trim().toLowerCase().transform(value => value.replace(/\.$/, '')).pipe(z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/))
export const UrlDomainListSchema = z.array(UrlDomainSchema).max(100).transform(values => [...new Set(values)])
