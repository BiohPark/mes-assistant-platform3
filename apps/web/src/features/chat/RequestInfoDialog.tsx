import { useQuery } from '@tanstack/react-query'
import { getRequest, snapshotUrl } from '@/api/requests'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { deliveryLabel, statusLabel } from './requestLabels'

export function RequestInfoDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const record = useQuery({ queryKey: ['request', requestId], queryFn: () => getRequest(requestId) })
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>사용한 자료</DialogTitle></DialogHeader>
    {record.data ? <div className="space-y-2 text-sm">
      <p>{statusLabel[record.data.status] ?? record.data.status} · {record.data.model} · {record.data.bytes ?? '계산 중'} / {record.data.limitBytes} bytes</p>
      {record.data.retryOf && <p>재시도한 요청: {record.data.retryOf}</p>}
      {record.data.error && <p role="alert" className="text-destructive">{record.data.error}</p>}
      <ul className="space-y-1">{record.data.inputs.map((input, index) => <li key={index} className="rounded border p-2">
        {input.weight === 'main' ? '★' : '☑'} {input.sourceLabel ?? input.fileId ?? '참조 대화'} {input.fileVersion ? `v${input.fileVersion}` : ''} · {deliveryLabel[input.delivery ?? ''] ?? input.delivery ?? '참조'} · {input.bytes} bytes
        {input.error && <span className="block text-destructive">{input.error}</span>}
      </li>)}</ul>
      <a className="underline" href={snapshotUrl(requestId)} download>원본 JSON 다운로드</a>
    </div> : record.isError ? <p role="alert">요청 기록을 불러오지 못했습니다.</p> : <p>불러오는 중…</p>}
  </DialogContent></Dialog>
}
