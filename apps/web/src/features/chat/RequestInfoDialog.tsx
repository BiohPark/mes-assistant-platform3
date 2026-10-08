import { useQuery } from '@tanstack/react-query'
import { getRequest, snapshotUrl } from '@/api/requests'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/i18n'
import { deliveryLabel, statusLabel } from './requestLabels'

export function RequestInfoDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const t = useT()
  const record = useQuery({ queryKey: ['request', requestId], queryFn: () => getRequest(requestId) })
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{t('chat.requestInfo')}</DialogTitle></DialogHeader>
    {record.data ? <div className="space-y-2 text-sm">
      <p>{statusLabel[record.data.status] ? t(statusLabel[record.data.status]!) : record.data.status} · {record.data.model} · {record.data.bytes ?? t('chat.calculating')} / {record.data.limitBytes} bytes</p>
      {record.data.retryOf && <p>{t('chat.retryOf', { id: record.data.retryOf })}</p>}
      {record.data.error && <p role="alert" className="text-destructive">{record.data.error}</p>}
      <ul className="space-y-1">{record.data.inputs.map((input, index) => <li key={index} className="rounded-xl border p-2">
        {input.weight === 'main' ? '★' : '☑'} {input.sourceLabel ?? input.fileId ?? t('chat.referenceConversationName')} {input.fileVersion ? `v${input.fileVersion}` : ''} · {input.kind === 'conversation' ? `${input.mode === 'summary' ? t('chat.summary') : input.mode === 'messages' ? t('chat.selectedMessages') : t('common.all')} · ${t('chat.messageTotal', { count: input.messageCount ?? 0 })}` : deliveryLabel[input.delivery ?? ''] ? t(deliveryLabel[input.delivery ?? '']!) : input.delivery ?? t('chat.reference')} · {input.bytes} bytes
        {input.error && <span className="block text-destructive">{input.error}</span>}
      </li>)}</ul>
      {record.data.hasSnapshot && <a className="underline" href={snapshotUrl(requestId)} download>{t('chat.downloadSnapshot')}</a>}
    </div> : record.isError ? <p role="alert">{t('chat.requestLoadFailed')}</p> : <p>{t('common.loading')}</p>}
  </DialogContent></Dialog>
}
