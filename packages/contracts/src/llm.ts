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
export const LlmTestMessageSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(32_768) }).strict()
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
