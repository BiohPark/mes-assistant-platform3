import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Task } from '@mes/domain'
import { completeTask, previewTaskReport } from '@/api/tasks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useT } from '@/i18n'

export function TaskCompleteDialog({ task, open, onOpenChange }: { task: Task; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const [rating, setRating] = useState(task.feedback?.rating ?? 0)
  const [comment, setComment] = useState(task.feedback?.comment ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const feedback = rating ? { rating, comment: comment.trim() } : undefined
  const missing = task.checklist.filter((item) => item.required && !item.checked)
  // 필수 체크 항목이 미완료면 사유 필수(서버도 400으로 강제). 리포트와 이력에 남는다.
  const completionReason = missing.length ? reason.trim() : ''
  const report = useQuery({ queryKey: ['task-report-preview', task.id, rating, comment, completionReason],
    queryFn: () => previewTaskReport(task.id, feedback, completionReason || undefined), enabled: open, retry: false })
  async function confirm() {
    setBusy(true)
    try { await completeTask(task.id, feedback, completionReason || undefined); toast.success(t('task.complete.done')); onOpenChange(false) }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{t('task.complete.title')}</DialogTitle><DialogDescription>{t('task.complete.description')}</DialogDescription></DialogHeader>
    {!!missing.length && <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
      <p>{t('task.complete.missing', { count: missing.length, items: missing.map((item) => item.label).join(', ') })} {t('taskComplete.reasonRequired')}</p>
      <Textarea aria-label={t('taskComplete.reasonLabel')} rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('taskComplete.reasonPlaceholder')} className="bg-background" />
    </section>}
    <section className="space-y-2 text-xs"><h3 className="font-semibold">{t('task.complete.feedback')}</h3>
      <div className="flex gap-1">{[1, 2, 3, 4, 5].map((value) => <Button key={value} type="button" size="xs" variant={rating === value ? 'default' : 'outline'} aria-label={t('task.complete.rating', { value })} onClick={() => setRating(value)}>★ {value}</Button>)}</div>
      <Textarea aria-label={t('task.complete.comment')} rows={2} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t('task.complete.commentPlaceholder')} />
    </section>
    <section className="space-y-1 text-xs"><h3 className="font-semibold">{t('task.complete.preview')}</h3>
      {report.isLoading && <p>{t('task.complete.reportLoading')}</p>}
      {report.isError && <p role="alert">{t('task.complete.reportFailed')} <button type="button" className="underline" onClick={() => void report.refetch()}>{t('common.retry')}</button></p>}
      {report.data && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border bg-muted/40 p-2 text-xs">{report.data.content}</pre>}
    </section>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t('common.cancel')}</Button><Button onClick={() => void confirm()} disabled={busy || !report.data || (!!missing.length && !completionReason)}>{t('task.complete.submit')}</Button></DialogFooter>
  </DialogContent></Dialog>
}
