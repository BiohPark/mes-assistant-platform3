/**
 * 요청 크기 한도. 직렬화한 요청 본문의 UTF-8 바이트로 잰다.
 * 모델의 토큰 한도와 다르다 — 한도 안이라고 모델 컨텍스트에 들어간다고 보장하지 않는다.
 * 넘으면 자동으로 자르거나 요약하지 않고 전송을 막는다(docs/fusion-design.md §5.8).
 */
export const DEFAULT_REQUEST_BUDGET_BYTES = 256 * 1024

const WARN_RATIO = 0.8

const encoder = new TextEncoder()

export function byteLength(text: string): number {
  return encoder.encode(text).byteLength
}

export function requestBytes(body: unknown): number {
  return byteLength(JSON.stringify(body))
}

export type BudgetLevel = 'ok' | 'warn' | 'over'

export function budgetLevel(bytes: number, limit: number): BudgetLevel {
  if (bytes > limit) return 'over'
  if (bytes > limit * WARN_RATIO) return 'warn'
  return 'ok'
}
