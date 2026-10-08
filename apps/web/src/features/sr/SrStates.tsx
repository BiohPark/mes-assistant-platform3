import { useT } from '@/i18n'
import { Button } from '@/components/ui/button'

/** 목록 로딩 뼈대. role=status를 쓰지 않는다 — 같은 화면의 안내(status)와 겹친다. */
export function SrSkeleton({ rows = 3, className = 'h-14' }: { rows?: number; className?: string }) {
  const t = useT()
  return <div aria-busy="true" aria-label={t('common.loading')} className="space-y-2">{Array.from({ length: rows }, (_, index) => <div key={index} className={`${className} animate-pulse rounded-lg bg-muted`} />)}</div>
}

export function SrLoadError({ error, retrying, onRetry }: { error: unknown; retrying?: boolean; onRetry: () => void }) {
  const t = useT()
  return <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm">
    <p className="font-medium">{t('sr.loadFailed')}</p>
    <p className="text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
    <Button size="sm" variant="outline" disabled={retrying} onClick={onRetry}>{t('common.retry')}</Button>
  </div>
}
