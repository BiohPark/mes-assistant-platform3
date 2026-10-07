import { useState } from 'react'
import { toast } from 'sonner'
import type { Task } from '@mes/domain'
import { addChecklistItem, applyChecklistReview, removeChecklistItem, reviewChecklist, toggleChecklist } from '@/api/tasks'
import { useUserMap } from '@/app/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDates } from '@/lib/dates'

export function ChecklistPanel({ task }: { task: Task }) {
  const { formatDateTime } = useDates()
  const users = useUserMap()
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const done = task.checklist.filter((item) => item.checked).length
  const missing = task.checklist.filter((item) => item.required && !item.checked).length
  const readOnly = task.status === 'done'
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try { await action() } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <section className="space-y-3 text-xs" data-testid="checklist-panel">
    <div className="font-semibold">체크리스트 {done}/{task.checklist.length}{missing > 0 && <span className="ml-2 font-normal text-amber-700">중요 {missing}개 미체크</span>}</div>
    <div className="h-1 rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: task.checklist.length ? `${done / task.checklist.length * 100}%` : '0%' }} /></div>
    <ul className="space-y-1">{task.checklist.map((item) => <li key={item.id} className="flex items-start gap-2 rounded-xl border p-2">
      <input type="checkbox" aria-label={item.label} checked={item.checked} disabled={readOnly || busy} onChange={() => void run(() => toggleChecklist(task.id, item.id))} />
      <div className="min-w-0 flex-1"><div className={item.checked ? 'text-muted-foreground line-through' : ''}>{item.label}{item.required && <span className="ml-1 text-amber-700">중요</span>}</div>
        {item.checkedAt && <div className="text-xs text-muted-foreground">{users.get(item.checkedBy ?? '')?.name ?? item.checkedBy} · {formatDateTime(item.checkedAt)}</div>}
      </div>
      {!readOnly && <Button variant="ghost" size="xs" aria-label={`${item.label} 삭제`} disabled={busy} onClick={() => void run(() => removeChecklistItem(task.id, item.id))}>삭제</Button>}
    </li>)}</ul>
    {!readOnly && <form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); if (label.trim() && !busy) { const submittedLabel = label; setLabel(''); void run(async () => { try { await addChecklistItem(task.id, submittedLabel) } catch (error) { setLabel(submittedLabel); throw error } }) } }}>
      <Input aria-label="체크리스트 새 항목" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="항목 추가" className="h-7 text-xs" disabled={busy} />
      <Button size="xs" type="submit" disabled={busy || !label.trim()}>추가</Button>
    </form>}
    <div className="rounded-xl border p-2">
      <div className="font-semibold">AI 달성도</div>
      {task.checklistReview ? <><p className="my-1">{task.checklistReview.met}/{task.checklistReview.total} 달성{task.checklistReview.source === 'rule' && ' · 규칙 판단'}</p>
        <ul className="space-y-1">{task.checklistReview.items.map((item) => <li key={item.itemId}>{item.met ? '✓' : '·'} {task.checklist.find((check) => check.id === item.itemId)?.label ?? '삭제된 항목'}{item.note && <span className="block pl-3 text-muted-foreground">{item.note}</span>}</li>)}</ul>
        {!readOnly && <Button size="xs" variant="outline" className="mt-2" disabled={busy} onClick={() => void run(() => applyChecklistReview(task.id))}>판단대로 체크</Button>}
      </> : <p className="my-1 text-muted-foreground">점검 결과가 없습니다.</p>}
      {!readOnly && <Button size="xs" variant="outline" className="mt-2" disabled={busy || !task.checklist.length} onClick={() => void run(() => reviewChecklist(task.id))}>AI 달성도 점검</Button>}
    </div>
  </section>
}
