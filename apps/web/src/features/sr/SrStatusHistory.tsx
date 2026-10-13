import { SR_STATUSES, srStage, type SrStatusChange, type SrStatus } from '@mes/domain'
import { useT } from '@/i18n'
import { useDates } from '@/lib/dates'
import { SR_STATUS_KEY } from '@/lib/labels'

const isSrStatus = (status: string): status is SrStatus => (SR_STATUSES as string[]).includes(status)

/** SR 상태 이력 — 시각·처리자·변경·사유(반려·완료). 접수자 화면과 처리 Sheet가 같이 쓴다. 옛 reviewing은 접수됨으로 보이고, 단계가 같은 변경(submitted → reviewing)은 숨긴다. */
export function SrStatusHistory({ history }: { history: SrStatusChange[] }) {
  const t = useT()
  const { formatDateTime } = useDates()
  const label = (status: string) => isSrStatus(status) ? t(SR_STATUS_KEY[srStage(status)]) : status
  const visible = history.filter((item) => !(isSrStatus(item.from) && isSrStatus(item.to) && srStage(item.from) === srStage(item.to)))
  if (!visible.length) return <p className="text-xs text-muted-foreground">{t('srFlow.noHistory')}</p>
  return <ol aria-label={t('srFlow.statusHistory')} className="space-y-1 text-xs">
    {visible.map((item) => <li key={item.id} className="flex flex-wrap gap-x-2 border-l-2 pl-2">
      <time dateTime={item.at} className="text-muted-foreground">{formatDateTime(item.at)}</time>
      <span className="font-medium">{item.byName || t('srFlow.system')}</span>
      <span>{t('srFlow.change', { from: label(item.from), to: label(item.to) })}</span>
      {item.reason && <span className="basis-full text-muted-foreground">{t('srFlow.reason', { reason: item.reason })}</span>}
    </li>)}
  </ol>
}
