import { createContext, use } from 'react'
import { MeSchema, type Me } from '@mes/contracts'

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

/** GET /api/me — 세션 쿠키로 인증 (토큰을 브라우저 저장소에 두지 않는다) */
export async function fetchMe(): Promise<Me> {
  const res = await fetch('/api/me', { credentials: 'same-origin' })
  if (!res.ok) throw new HttpError(res.status)
  return MeSchema.parse(await res.json())
}

export async function logout(): Promise<void> {
  const res = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  if (!res.ok) throw new HttpError(res.status)
}

export const MeContext = createContext<Me | null>(null)

/** AuthGate 안에서만 쓴다 — 로그인 사용자 */
export function useMe(): Me {
  const me = use(MeContext)
  if (!me) throw new Error('useMe는 AuthGate 안에서만 쓸 수 있습니다')
  return me
}
