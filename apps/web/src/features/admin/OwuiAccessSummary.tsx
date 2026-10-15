import { useEffect, useState } from 'react'
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

/** 연결 진단에서 선택한 에이전트의 모델 접근·권한을 읽기만으로 확인한다. */
export function OwuiAccessSummary({ modelId }: { modelId: string }) {
  const t = useT()
  const model = useDebounced(modelId.trim(), DEBOUNCE_MS)
  const check = useQuery({ queryKey: ['owui-access', model], queryFn: () => checkOpenWebUiAccess(model), enabled: !!model, retry: false, refetchOnWindowFocus: false })
  const rows = check.data ? accessRows(check.data, t) : null
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
