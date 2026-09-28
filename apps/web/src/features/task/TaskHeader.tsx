import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { CheckCircle2, PauseCircle, PlayCircle, Trash2 } from 'lucide-react'
import type { Task, TaskStatus } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { addTag, deleteTask, removeTag, setTaskStatus, setTaskTitle } from '@/api/tasks'
import { useActor } from '@/app/hooks'
import { useTagSuggest } from '@/app/useTagSuggest'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { TagInput } from '@/components/TagInput'
import { ReasonDialog } from '@/components/ReasonDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PriorityBadge, TaskStatusBadge } from '@/components/StatusBadges'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** 데모 TaskHeader의 제목·상태·태그 작업. S4 완료 리포트는 이 단계에서 제외한다. */
export function TaskHeader({ task, assistant }: { task: Task; assistant: Assistant }) {
  const actor = useActor()
  const query = useQueryClient()
  const suggest = useTagSuggest()
  const navigate = useNavigate()
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [reopen, setReopen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const saving = useRef(false)
  const refresh = () => { void query.invalidateQueries({ queryKey: ['task', task.id] }); void query.invalidateQueries({ queryKey: ['tasks'] }) }

  async function commitTitle() {
    if (saving.current) return
    saving.current = true
    setEditingTitle(false)
    const next = title.trim()
    if (next && next !== task.title) {
      try { await setTaskTitle(task.id, next, 'manual'); refresh() }
      catch (error) { toast.error(error instanceof Error ? error.message : '제목을 저장하지 못했습니다') }
    } else setTitle(task.title)
    saving.current = false
  }
  async function changeStatus(status: TaskStatus, reason?: string) {
    try { await setTaskStatus(actor, task.id, status, reason ? { reason } : {}); refresh(); return true }
    catch (error) { toast.error(error instanceof Error ? error.message : '상태를 바꾸지 못했습니다'); return false }
  }
  async function remove() {
    const result = await deleteTask(task.id)
    if (!result.ok) { toast.error(result.reason); return }
    navigate('/?view=kanban')
  }

  return <div className="border-b bg-card px-4 py-3">
    <div className="flex flex-wrap items-center gap-2">
      <Link to={`/?view=kanban&assistant=${encodeURIComponent(assistant.id)}`} className="inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-0.5 text-xs hover:bg-muted"><AssistantAvatar assistant={assistant} size="xs" />{assistant.name}</Link>
      <span className="font-mono text-xs text-muted-foreground">{task.code}</span>
      <TaskStatusBadge status={task.status} />
      <PriorityBadge priority={task.priority} />
      <div className="ml-auto flex items-center gap-1">
        {task.status === 'done' ? <Button size="sm" variant="outline" onClick={() => setReopen(true)}><PlayCircle data-icon="inline-start" />다시 열기</Button> : <>
          {task.status === 'on_hold' ? <Button size="sm" variant="outline" onClick={() => void changeStatus('in_progress')}><PlayCircle data-icon="inline-start" />재개</Button> : <Button size="sm" variant="outline" onClick={() => void changeStatus('on_hold')}><PauseCircle data-icon="inline-start" />보류</Button>}
          <Button size="sm" onClick={() => void changeStatus('done')}><CheckCircle2 data-icon="inline-start" />업무 완료</Button>
        </>}
        <Button variant="ghost" size="icon-sm" aria-label="대화 삭제" onClick={() => setConfirmDelete(true)}><Trash2 /></Button>
      </div>
    </div>
    <div className="mt-2">{editingTitle ? <Input aria-label="대화 제목" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => void commitTitle()} onKeyDown={(event) => { if (event.key === 'Enter') void commitTitle(); if (event.key === 'Escape') { setTitle(task.title); setEditingTitle(false) } }} autoFocus className="h-8 text-base font-semibold" /> : <button type="button" className="text-left text-base font-semibold hover:underline" disabled={task.status === 'done'} onClick={() => { setTitle(task.title); setEditingTitle(true) }}>{task.title}</button>}
      {task.summary && <p className="mt-0.5 text-xs text-muted-foreground">{task.summary}</p>}
    </div>
    <div className="mt-2"><TagInput tags={task.tags} suggest={suggest} readOnly={task.status === 'done'} onAdd={async (value) => { await addTag(actor, task.id, value); refresh() }} onRemove={async (value) => { await removeTag(actor, task.id, value); refresh() }} onChipClick={(value) => navigate(`/?view=kanban&tag=${encodeURIComponent(value)}`)} /></div>
    <ReasonDialog open={reopen} onOpenChange={setReopen} title="완료된 업무를 다시 열까요?" description="재개 사유를 이력에 기록합니다." confirmLabel="재개 확인" onConfirm={(reason) => changeStatus('in_progress', reason)} />
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="대화를 삭제할까요?" description="메시지와 이 대화에서 만든 자료가 삭제됩니다." onConfirm={remove} />
  </div>
}
