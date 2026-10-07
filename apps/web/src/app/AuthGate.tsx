import { useT } from '@/i18n'
import { useEffect, useEffectEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useTheme } from 'next-themes'
import { useProfile } from './profile'
import { Button } from '@/components/ui/button'
import { HttpError, MeContext, fetchAuthMode, fetchMe } from './auth'

const isUnauthorized = (err: unknown) => err instanceof HttpError && err.status === 401

interface AuthGateProps {
  children: ReactNode
  redirectToLogin?: (url: string) => void
  /** 401이 아닌 오류의 재시도 간격 (기본 1초 × 5회 ≈ api 기동 시간) */
  retryDelayMs?: number
}

/** 로그인 사용자를 확인하고, 세션이 없으면 설정된 로그인 화면으로 보낸다 */
export function AuthGate({ children, redirectToLogin, retryDelayMs = 1000 }: AuthGateProps) {
  const t = useT()
  const navigate = useNavigate()
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    // 401은 곧바로 로그인으로. 그 밖의 오류(api 기동·재시작 중 등)는 5번 더 시도한 뒤 알린다
    retry: (failures, err) => !isUnauthorized(err) && failures < 5,
    retryDelay: retryDelayMs,
    staleTime: 60_000,
  })
  const { setTheme } = useTheme()
  const { setLocale, saving } = useProfile()
  const applyProfile = useEffectEvent(() => {
    if (!data) return
    if (saving?.theme === undefined) setTheme(data.theme)
    if (saving?.locale === undefined) setLocale(data.locale)
  })
  useEffect(() => { applyProfile() }, [data?.theme, data?.locale])
  const unauthorized = isUnauthorized(error)
  const { data: mode, error: modeError, refetch: refetchMode, isFetching: isFetchingMode } = useQuery({
    queryKey: ['auth-mode'], queryFn: fetchAuthMode, staleTime: Infinity, enabled: unauthorized,
    retry: (failures) => failures < 5, retryDelay: retryDelayMs,
  })

  useEffect(() => {
    if (!unauthorized || !mode) return
    const url = mode === 'local' ? '/login' : '/api/auth/login'
    if (redirectToLogin) redirectToLogin(url)
    else if (mode === 'local') void navigate(url, { replace: true })
    else window.location.assign(url)
  }, [unauthorized, mode, redirectToLogin, navigate])

  if (data) return <MeContext value={data}>{children}</MeContext>
  if ((error && !unauthorized) || modeError) {
    return (
      <div role="alert" className="p-8 text-sm">
        <h1 className="mb-2 text-lg font-semibold">{t('common.serverUnavailable')}</h1>
        <p className="mb-3 text-muted-foreground">{t('common.serverUnavailableHelp')}</p>
        <Button size="sm" variant="outline" disabled={isFetching || isFetchingMode} onClick={() => void (modeError ? refetchMode() : refetch())}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }
  return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>
}
