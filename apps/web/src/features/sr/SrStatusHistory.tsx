import type { SrStatusChange, SrStatus } from '@mes/domain'
import { useT } from '@/i18n'
import { useDates } from '@/lib/dates'
import { SR_STATUS_KEY } from '@/lib/labels'

/** SR 상태 이력 — 시각·처리자·변경·사유(반려·완료). 접수자 화면과 처리 Sheet가 같이 쓴다. */
export function SrStatusHistory({ history }: { history: SrStatusChange[] }) {
  const t = useT()
  const { formatDateTime } = useDates()
  const label = (status: string) => status in SR_STATUS_KEY ? t(SR_STATUS_KEY[status as SrStatus]) : status
  if (!history.length) return <p className="text-xs text-muted-foreground">{t('srFlow.noHistory')}</p>
  return <ol aria-label={t('srFlow.statusHistory')} className="space-y-1 text-xs">
    {history.map((item) => <li key={item.id} className="flex flex-wrap gap-x-2 border-l-2 pl-2">
      <time dateTime={item.at} className="text-muted-foreground">{formatDateTime(item.at)}</time>
      <span className="font-medium">{item.byName || t('srFlow.system')}</span>
      <span>{t('srFlow.change', { from: label(item.from), to: label(item.to) })}</span>
      {item.reason && <span className="basis-full text-muted-foreground">{t('srFlow.reason', { reason: item.reason })}</span>}
    </li>)}
  </ol>
}
