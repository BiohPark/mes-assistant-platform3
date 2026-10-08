import { useT } from '@/i18n'
import { AlertTriangle } from 'lucide-react'
import { Link, useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'
import { isModuleLoadError } from './lazyPage'

/** 라우트 errorElement — 모듈 로드 실패(새 버전 배포)와 그 밖의 화면 오류를 앱 스타일로 보여 준다 */
export function RouteErrorPage() {
  const t = useT()
  const error = useRouteError()
  const stale = isModuleLoadError(error)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/30 p-8 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <AlertTriangle className="size-5" />
      </span>
      <h1 className="text-lg font-semibold">{t(stale ? 'routeError.staleTitle' : 'routeError.title')}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t(stale ? 'routeError.staleDescription' : 'routeError.description')}</p>
      {!stale && error instanceof Error && <p className="max-w-md font-mono text-xs text-muted-foreground">{error.message}</p>}
      <div className="flex gap-2">
        <Button onClick={() => window.location.reload()}>{t('routeError.reload')}</Button>
        <Button variant="outline" asChild><Link to="/">{t('routeError.home')}</Link></Button>
      </div>
    </div>
  )
}
