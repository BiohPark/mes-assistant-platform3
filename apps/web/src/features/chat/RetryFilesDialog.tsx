import { useState } from 'react'
import type { RequestRecord } from '@/api/requests'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export function RetryFilesDialog({ record, mode, onClose, onSubmit }: {
  record: RequestRecord; mode: 'exclude' | 'inline'; onClose: () => void; onSubmit: (ids: string[]) => Promise<void>
}) {
  const files = record.inputs.filter((input) => input.kind === 'file' && input.fileId && (mode === 'exclude' || /\.(txt|md|json|csv|xml|html|yaml|yml)(?:\s|$)/i.test(input.sourceLabel ?? '')))
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}><DialogContent><DialogHeader><DialogTitle>{mode === 'exclude' ? '다시 보낼 때 뺄 파일' : '본문으로 보낼 텍스트 파일'}</DialogTitle></DialogHeader>
    <div className="space-y-2">{files.map((input) => <label key={input.fileId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(input.fileId!)}
      onChange={(event) => setSelected((current) => event.target.checked ? [...current, input.fileId!] : current.filter((id) => id !== input.fileId))} />{input.sourceLabel ?? input.fileId}</label>)}</div>
    {!files.length && <p className="text-sm text-muted-foreground">선택할 수 있는 파일이 없습니다.</p>}
    <Button disabled={!selected.length || busy} onClick={() => { setBusy(true); void onSubmit(selected).finally(() => setBusy(false)) }}>다시 시도</Button>
  </DialogContent></Dialog>
}
