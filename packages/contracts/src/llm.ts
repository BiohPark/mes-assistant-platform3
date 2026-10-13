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
/** 결과에는 본문·파일·키·주소가 없다 — 프레임은 키 경로, 오류는 가린 120자 이내 문구 */
export const OwuiProbeAttemptSchema = z.object({
  mode: z.enum(['current', 'legacy']),
  status: z.number().int().nullable(),
  firstByteMs: z.number().nullable(),
  firstContentMs: z.number().nullable(),
  totalMs: z.number(),
  frames: z.array(z.string()),
  error: z.string().max(120).optional(),
})
export const OwuiProbeResultSchema = z.object({
  model: z.string(),
  version: z.string().nullable(),
  meta: z.object({
    found: z.boolean(),
    toolIds: z.array(z.string()),
    defaultFeatureIds: z.array(z.string()),
    capabilities: z.record(z.string(), z.boolean()),
    knowledgeCount: z.number(),
    functionCalling: z.string().nullable(),
    error: z.string().max(120).optional(),
  }),
  attempts: z.array(OwuiProbeAttemptSchema),
  ms: z.number(),
})
export type OwuiProbeRequest = z.infer<typeof OwuiProbeRequestSchema>
export type OwuiProbeAttemptResult = z.infer<typeof OwuiProbeAttemptSchema>
export type OwuiProbeReport = z.infer<typeof OwuiProbeResultSchema>
