import { ResponseDiagnosticColumns } from './ResponseDiagnosticColumns'
import { useState } from 'react'
import { copyText } from '@/lib/clipboard'
import { Button } from '@/components/ui/button'
import { useQuery } from '@tanstack/react-query'
import { getRequest, getResponseDiagnostic, snapshotUrl } from '@/api/requests'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/i18n'
import { deliveryLabel, statusLabel } from './requestLabels'

export function RequestInfoDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const t = useT()
  const [showResponse, setShowResponse] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const diagnostic = useQuery({ queryKey: ['response-diagnostic', requestId], queryFn: () => getResponseDiagnostic(requestId), enabled: showResponse })
  const record = useQuery({ queryKey: ['request', requestId], queryFn: () => getRequest(requestId) })
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}><DialogContent className={showResponse ? "max-h-[90vh] overflow-auto sm:max-w-6xl" : "max-h-[90vh] overflow-auto sm:max-w-lg"}><DialogHeader><DialogTitle>{t('chat.requestInfo')}</DialogTitle></DialogHeader>
    {record.data ? <div className="space-y-2 text-sm">
      <p>{statusLabel[record.data.status] ? t(statusLabel[record.data.status]!) : record.data.status} · {record.data.model} · {record.data.bytes ?? t('chat.calculating')} / {record.data.limitBytes} bytes</p>
      {record.data.owuiTools && <div className="rounded-xl border p-2">
        <p>{t(record.data.owuiTools.mode === 'tools' ? 'chat.owuiTools' : record.data.owuiTools.mode === 'fallback' ? 'chat.owuiFallback' : 'chat.owuiBasic')}</p>
        {record.data.owuiTools.tool_ids && <p className="break-all">tool_ids: {JSON.stringify(record.data.owuiTools.tool_ids)}</p>}
        {record.data.owuiTools.features && <p className="break-all">features: {JSON.stringify(record.data.owuiTools.features)}</p>}
      </div>}
      {record.data.retryOf && <p>{t('chat.retryOf', { id: record.data.retryOf })}</p>}
      {record.data.error && <p role="alert" className="text-destructive">{record.data.error}</p>}
      <ul className="space-y-1">{record.data.inputs.map((input, index) => <li key={index} className="rounded-xl border p-2">
        {input.weight === 'main' ? '★' : '☑'} {input.sourceLabel ?? input.fileId ?? t('chat.referenceConversationName')} {input.fileVersion ? `v${input.fileVersion}` : ''} · {input.kind === 'conversation' ? `${input.mode === 'summary' ? t('chat.summary') : input.mode === 'messages' ? t('chat.selectedMessages') : t('common.all')} · ${t('chat.messageTotal', { count: input.messageCount ?? 0 })}` : deliveryLabel[input.delivery ?? ''] ? t(deliveryLabel[input.delivery ?? '']!) : input.delivery ?? t('chat.reference')} · {input.bytes} bytes
        {input.error && <span className="block text-destructive">{input.error}</span>}
      </li>)}</ul>
      {!!record.data.webPages?.length && <ul className="space-y-1">{record.data.webPages.map(page => <li key={page.url} className="break-all rounded-xl border p-2">
        🔗 <a href={page.url} target="_blank" rel="noreferrer" className="underline">{page.url}</a> · {page.bytes} bytes · {page.status === 'read' ? t('chat.webPageRead') : t('chat.webPageFailed', { reason: page.error ?? '' })}
        {page.finalUrl && page.finalUrl !== page.url && <span className="block">→ {page.finalUrl}</span>}
      </li>)}</ul>}
      {record.data.canViewRawResponse && <Button variant="outline" aria-expanded={showResponse} onClick={() => setShowResponse(!showResponse)}>{t('chat.viewRawResponse')}</Button>}
      {showResponse && <section className="space-y-2" aria-label={t('chat.viewRawResponse')}>
        {diagnostic.data ? <>
          <Button variant="outline" onClick={async () => { setCopyFailed(!await copyText(JSON.stringify(diagnostic.data, null, 2))) }}>{t('chat.copyJson')}</Button>
          {copyFailed && <p role="alert">{t('chat.copyFailed')}</p>}
          <ResponseDiagnosticColumns result={diagnostic.data} />
        </> : diagnostic.isError ? <p role="alert">{t('chat.requestLoadFailed')}</p> : <p>{t('common.loading')}</p>}
      </section>}
      {record.data.hasSnapshot && <a className="underline" href={snapshotUrl(requestId)} download>{t('chat.downloadSnapshot')}</a>}
    </div> : record.isError ? <p role="alert">{t('chat.requestLoadFailed')}</p> : <p>{t('common.loading')}</p>}
  </DialogContent></Dialog>
}
