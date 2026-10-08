import { LlmTestConnectionSchema, LlmTestErrorCodeSchema, LlmTestResultSchema, type LlmTestConnection, type LlmTestErrorCode, type LlmTestRequest, type LlmTestResult } from '@mes/contracts'

/** 시험 API 실패 — 상태 코드와 서버 분류 코드를 함께 담는다 */
export class LlmTestError extends Error {
  readonly status: number
  readonly code?: LlmTestErrorCode
  constructor(status: number, message: string, code?: LlmTestErrorCode) {
    super(message)
    this.name = 'LlmTestError'
    this.status = status
    this.code = code
  }
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/admin/llm/${path}`, { method: 'POST', credentials: 'same-origin', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null)
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {}
    const message = typeof record.message === 'string' ? record.message : `HTTP ${response.status}`
    throw new LlmTestError(response.status, message, LlmTestErrorCodeSchema.safeParse(record.code).data)
  }
  return response.json()
}

export const testConnection = async (): Promise<LlmTestConnection> => LlmTestConnectionSchema.parse(await post('test-connection', {}))
export const testChat = async (body: LlmTestRequest, signal?: AbortSignal): Promise<LlmTestResult> => LlmTestResultSchema.parse(await post('test', body, signal))
