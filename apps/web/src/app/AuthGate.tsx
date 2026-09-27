import { useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HttpError, MeContext, fetchMe } from './auth'

const goToLogin = () => window.location.assign('/api/auth/login')

interface AuthGateProps {
  children: ReactNode
  redirectToLogin?: () => void
}

/** 로그인 사용자를 확인하고, 세션이 없으면 SSO 로그인으로 보낸다 */
export function AuthGate({ children, redirectToLogin = goToLogin }: AuthGateProps) {
  const { data, error } = useQuery({ queryKey: ['me'], queryFn: fetchMe, retry: false, staleTime: 60_000 })
  const unauthorized = error instanceof HttpError && error.status === 401

  useEffect(() => {
    if (unauthorized) redirectToLogin()
  }, [unauthorized, redirectToLogin])

  if (data) return <MeContext value={data}>{children}</MeContext>
  if (error && !unauthorized) {
    return (
      <div role="alert" className="p-8 text-sm">
        <h1 className="mb-2 text-lg font-semibold">서버에 연결할 수 없습니다</h1>
        <p className="text-muted-foreground">잠시 뒤 새로고침하세요. 계속되면 관리자에게 알려 주세요.</p>
      </div>
    )
  }
  return <div className="p-4 text-sm text-muted-foreground">불러오는 중…</div>
}
