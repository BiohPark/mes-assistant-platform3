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
const OWUI_CAPABILITIES = ['vision', 'file_upload', 'file_context', 'web_search', 'image_generation', 'code_interpreter', 'citations', 'status_updates', 'usage', 'builtin_tools'] as const
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
export const OwuiProbeAttemptSchema = z.object({
  mode: z.enum(['current', 'legacy']),
  status: z.number().int().nullable(),
  firstByteMs: z.number().nullable(),
  firstContentMs: z.number().nullable(),
  totalMs: z.number(),
  frames: z.array(z.string().regex(FRAME)).max(41),
  error: z.string().regex(PROBE_ERROR).optional(),
})
export const OwuiProbeResultSchema = z.object({
  model: notSecret(z.string().regex(PROBE_MODEL)).refine((value) => !HOST_OR_FILE.test(value)),
  version: notSecret(z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[A-Za-z0-9]{1,16})?$/)).nullable(),
  meta: z.object({
    found: z.boolean(),
    toolIds: z.array(notSecret(z.string().regex(PROBE_ID))).max(20),
    defaultFeatureIds: z.array(notSecret(z.string().regex(PROBE_ID))).max(20),
    capabilities: z.partialRecord(z.enum(OWUI_CAPABILITIES), z.boolean()),
    knowledgeCount: z.number().int(),
    functionCalling: z.enum(['native', 'legacy', 'default', '기타']).nullable(),
    error: z.string().regex(PROBE_ERROR).optional(),
  }),
  attempts: z.array(OwuiProbeAttemptSchema).max(2),
  ms: z.number(),
})
export type OwuiProbeRequest = z.infer<typeof OwuiProbeRequestSchema>
export type OwuiProbeAttemptResult = z.infer<typeof OwuiProbeAttemptSchema>
export type OwuiProbeReport = z.infer<typeof OwuiProbeResultSchema>
