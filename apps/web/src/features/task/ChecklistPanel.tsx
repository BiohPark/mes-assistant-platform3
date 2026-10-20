import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { ChecklistReview, ChecklistReviewItem, Task } from '@mes/domain'
import { addChecklistItem, applyChecklistReview, removeChecklistItem, reviewChecklist, toggleChecklist } from '@/api/tasks'
import { useUserMap } from '@/app/hooks'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useDates } from '@/lib/dates'
import { useT } from '@/i18n'
import { useMaterialsDrawer, useRailState } from './materialsDrawer'

export function ChecklistPanel({ task }: { task: Task }) {
  const { formatDateTime } = useDates()
  const users = useUserMap()
  const t = useT()
  const { checklistDraft: label } = useRailState(task.id)
  const update = useMaterialsDrawer(s => s.update)
  const setLabel = (checklistDraft: string) => update(task.id, { checklistDraft })
  const [busy, setBusy] = useState(false)
  const [reviewSince, setReviewSince] = useState<number>()
  const [now, setNow] = useState(Date.now)
  const [reviewItems, setReviewItems] = useState<ChecklistReviewItem[]>([])
  const [savedReview, setSavedReview] = useState<ChecklistReview>()
  const reviewController = useRef<AbortController | null>(null)
  useEffect(() => {
    setBusy(false)
    setReviewSince(undefined)
    setReviewItems([])
    setSavedReview(undefined)
    return () => { reviewController.current?.abort(); reviewController.current = null }
  }, [task.id])
  useEffect(() => { setSavedReview(undefined) }, [task.checklistReview])
  useEffect(() => {
    if (reviewSince === undefined) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [reviewSince])
  const review = savedReview ?? task.checklistReview
  async function runReview() {
    if (busy || reviewController.current) return
    const controller = new AbortController()
    reviewController.current = controller
    setBusy(true)
    setReviewSince(Date.now())
    setReviewItems([])
    try {
      const result = await reviewChecklist(task.id, (item) => {
        if (!controller.signal.aborted) setReviewItems(current => [...current.filter(entry => entry.itemId !== item.itemId), item])
      }, controller.signal)
      if (!controller.signal.aborted) setSavedReview(result)
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      if (reviewController.current === controller) {
        reviewController.current = null
        setReviewSince(undefined)
        setReviewItems([])
        setBusy(false)
      }
    }
  }
  const done = task.checklist.filter((item) => item.checked).length
  const missing = task.checklist.filter((item) => item.required && !item.checked).length
  const readOnly = task.status === 'done'
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try { await action() } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <section className="space-y-3 text-xs" data-testid="checklist-panel">
    <div className="font-semibold">{t('task.checklist.title', { done, total: task.checklist.length })}{missing > 0 && <span className="ml-2 font-normal text-tone-warning-fg">{t('task.checklist.missingRequired', { count: missing })}</span>}</div>
    <div className="h-1 rounded-full bg-muted"><div className="h-full rounded-full bg-tone-success-fg" style={{ width: task.checklist.length ? `${done / task.checklist.length * 100}%` : '0%' }} /></div>
    <ul className="space-y-1">{task.checklist.map((item) => <li key={item.id} className="flex items-start gap-2 rounded-xl border p-2">
      <Checkbox className="mt-0.5" aria-label={item.label} checked={item.checked} disabled={readOnly || busy} onCheckedChange={() => void run(() => toggleChecklist(task.id, item.id))} />
      <div className="min-w-0 flex-1"><div className={item.checked ? 'text-muted-foreground line-through' : ''}>{item.label}{item.required && <span className="ml-1 text-tone-warning-fg">{t('task.checklist.required')}</span>}</div>
        {item.checkedAt && <div className="text-xs text-muted-foreground">{users.get(item.checkedBy ?? '')?.name ?? item.checkedBy} · {formatDateTime(item.checkedAt)}</div>}
      </div>
      {!readOnly && <Button variant="ghost" size="xs" aria-label={t('task.checklist.deleteItem', { label: item.label })} disabled={busy} onClick={() => void run(() => removeChecklistItem(task.id, item.id))}>{t('task.delete')}</Button>}
    </li>)}</ul>
    {!readOnly && <form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); if (label.trim() && !busy) { const submittedLabel = label; setLabel(''); void run(async () => { try { await addChecklistItem(task.id, submittedLabel) } catch (error) { setLabel(submittedLabel); throw error } }) } }}>
      <Input aria-label={t('task.checklist.newItem')} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t('task.checklist.addPlaceholder')} className="h-7 text-xs" disabled={busy} />
      <Button size="xs" type="submit" disabled={busy || !label.trim()}>{t('task.checklist.add')}</Button>
    </form>}
    <div className="rounded-xl border p-2">
      <div className="font-semibold">{t('task.checklist.aiReview')}</div>
      {reviewSince !== undefined ? <div className="my-2 space-y-2">
        <div className="flex items-center gap-1 text-muted-foreground"><span role="status">{t('chat.thinking')}</span><span aria-hidden>·</span><span role="timer" aria-live="off">{t('chat.elapsed', { seconds: Math.max(0, Math.floor((now - reviewSince) / 1000)) })}</span></div>
        <ul className="space-y-1">{reviewItems.map(item => <li key={item.itemId}>{item.met ? '✓' : '·'} {task.checklist.find(check => check.id === item.itemId)?.label ?? t('task.checklist.deletedItem')}
          {item.note && <span className="block pl-3 text-muted-foreground">{item.note}</span>}
        </li>)}</ul>
      </div> : review ? <><p className="my-1">{t('task.checklist.achieved', { met: review.met, total: review.total })}{review.source === 'rule' && t('task.checklist.ruleBased')}</p>
        {review.source === 'rule' && <p className="my-1 text-tone-warning-fg">{t('task.checklist.ruleFallback')}</p>}
        <ul className="space-y-1">{review.items.map((item) => <li key={item.itemId}>{item.met ? '✓' : '·'} {task.checklist.find((check) => check.id === item.itemId)?.label ?? t('task.checklist.deletedItem')}{item.note && <span className="block pl-3 text-muted-foreground">{item.note}</span>}</li>)}</ul>
        {!readOnly && <Button size="xs" variant="outline" className="mt-2" disabled={busy} onClick={() => void run(() => applyChecklistReview(task.id))}>{t('task.checklist.applyReview')}</Button>}
      </> : <p className="my-1 text-muted-foreground">{t('task.checklist.noReview')}</p>}
      {!readOnly && <Button size="xs" variant="outline" className="mt-2" disabled={busy || !task.checklist.length} onClick={() => void runReview()}>{t('task.checklist.runReview')}</Button>}
    </div>
  </section>
}
