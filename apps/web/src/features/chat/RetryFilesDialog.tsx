import { useState } from 'react'
import type { RequestRecord } from '@/api/requests'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

export function RetryFilesDialog({ record, mode, onClose, onSubmit }: {
  record: RequestRecord; mode: 'exclude' | 'inline'; onClose: () => void; onSubmit: (ids: string[]) => Promise<void>
}) {
  const t = useT()
  const files = record.inputs.filter((input) => input.kind === 'file' && input.fileId && (mode === 'exclude' || /\.(txt|md|json|csv|xml|html|yaml|yml)(?:\s|$)/i.test(input.sourceLabel ?? '')))
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}><DialogContent><DialogHeader><DialogTitle>{mode === 'exclude' ? t('chat.excludeFilesTitle') : t('chat.inlineFilesTitle')}</DialogTitle></DialogHeader>
    <div className="space-y-2">{files.map((input) => <label key={input.fileId} className="flex items-center gap-2 text-sm"><Checkbox aria-label={input.sourceLabel ?? input.fileId!} checked={selected.includes(input.fileId!)}
      onCheckedChange={(checked) => setSelected((current) => checked === true ? [...current, input.fileId!] : current.filter((id) => id !== input.fileId))} />{input.sourceLabel ?? input.fileId}</label>)}</div>
    {!files.length && <p className="text-sm text-muted-foreground">{t('chat.noSelectableFiles')}</p>}
    <Button disabled={!selected.length || busy} onClick={() => { setBusy(true); void onSubmit(selected).finally(() => setBusy(false)) }}>{t('common.retry')}</Button>
  </DialogContent></Dialog>
}
