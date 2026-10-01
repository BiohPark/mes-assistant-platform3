import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Task } from '@mes/domain'
import { completeTask, previewTaskReport } from '@/api/tasks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

export function TaskCompleteDialog({ task, open, onOpenChange }: { task: Task; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [rating, setRating] = useState(task.feedback?.rating ?? 0)
  const [comment, setComment] = useState(task.feedback?.comment ?? '')
  const [busy, setBusy] = useState(false)
  const feedback = rating ? { rating, comment: comment.trim() } : undefined
  const report = useQuery({ queryKey: ['task-report-preview', task.id, rating, comment],
    queryFn: () => previewTaskReport(task.id, feedback), enabled: open, retry: false })
  const missing = task.checklist.filter((item) => item.required && !item.checked)
  async function confirm() {
    setBusy(true)
    try { await completeTask(task.id, feedback); toast.success('업무를 완료했습니다. 완료 리포트가 파일함에 저장되었습니다.'); onOpenChange(false) }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>업무 완료</DialogTitle><DialogDescription>리포트와 입력 출처를 확인하고 피드백을 남기세요. 완료 리포트가 산출물로 저장됩니다.</DialogDescription></DialogHeader>
    {!!missing.length && <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">중요 체크 {missing.length}건 미체크: {missing.map((item) => item.label).join(', ')}. 그대로 완료할 수 있습니다.</p>}
    <section className="space-y-2 text-xs"><h3 className="font-semibold">assistant 피드백</h3>
      <div className="flex gap-1">{[1, 2, 3, 4, 5].map((value) => <Button key={value} type="button" size="xs" variant={rating === value ? 'default' : 'outline'} aria-label={`${value}점`} onClick={() => setRating(value)}>★ {value}</Button>)}</div>
      <Textarea aria-label="피드백 코멘트" rows={2} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="도움이 된 점과 아쉬운 점" />
    </section>
    <section className="space-y-1 text-xs"><h3 className="font-semibold">완료 리포트 미리보기</h3>
      {report.isLoading && <p>리포트를 불러오는 중…</p>}
      {report.isError && <p role="alert">리포트를 불러오지 못했습니다. <button type="button" className="underline" onClick={() => void report.refetch()}>다시 시도</button></p>}
      {report.data && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-muted/40 p-2 text-[11px]">{report.data.content}</pre>}
    </section>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>취소</Button><Button onClick={() => void confirm()} disabled={busy || !report.data}>완료 처리</Button></DialogFooter>
  </DialogContent></Dialog>
}
