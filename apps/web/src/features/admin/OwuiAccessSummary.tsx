import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { checkOpenWebUiAccess } from '@/api/admin'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { accessRows } from './DiagnosticsOwuiProbe'

/** 입력 중인 모델 ID가 멈춘 뒤에만 확인한다 */
const DEBOUNCE_MS = 500
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/**
 * 에이전트 편집의 OpenWebUI 연결 확인(S13-J, SO 전용 시트 안) — 연결 모델의 도구·스킬 접근, 기본 터미널, 지식, 서비스 계정 권한, fetch_url 조건.
 * 모델을 부르지 않는 읽기 확인만 하고, 결과는 진단과 같은 행(이름·불린)으로 보인다. onIssue는 결과가 올 때마다 ❌가 있는지 알린다(편집 가이드의 '여기예요').
 */
export function OwuiAccessSummary({ modelId, onIssue }: { modelId: string; onIssue?: (issue: boolean) => void }) {
  const t = useT()
  const model = useDebounced(modelId.trim(), DEBOUNCE_MS)
  const check = useQuery({ queryKey: ['owui-access', model], queryFn: () => checkOpenWebUiAccess(model), enabled: !!model, retry: false, refetchOnWindowFocus: false })
  const latestOnIssue = useRef(onIssue)
  latestOnIssue.current = onIssue
  const rows = check.data ? accessRows(check.data, t) : null
  const issue = rows?.some(([, value]) => value.includes('❌')) ?? null
  useEffect(() => { if (issue !== null) latestOnIssue.current?.(issue) }, [issue, check.data])
  return <section aria-label={t('admin.manage.owuiCheck.title')} className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-medium">{t('admin.manage.owuiCheck.title')}</h3>
      <Button type="button" variant="outline" size="xs" disabled={!model || check.isFetching} onClick={() => void check.refetch()}>{t('admin.manage.owuiCheck.refresh')}</Button>
    </div>
    {!modelId.trim() ? <p className="text-muted-foreground">{t('admin.manage.owuiCheck.noModel')}</p>
      : check.isError ? <p className="text-muted-foreground">{t('admin.manage.owuiCheck.failed', { error: check.error.message })}</p>
      : check.data ? <div role="status"><dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-3 gap-y-1">
        {rows!.map(([name, value], index) => <div className="contents" key={index}><dt className="text-muted-foreground">{name}</dt><dd className="break-all font-mono text-xs leading-5">{value}</dd></div>)}
      </dl></div>
      : <p className="text-muted-foreground">{t('admin.manage.owuiCheck.checking')}</p>}
  </section>
}
