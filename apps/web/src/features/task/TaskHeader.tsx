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
import { useT } from '@/i18n'
import { RelatedStrip } from './RelatedStrip'
import { TaskCompleteDialog } from './TaskCompleteDialog'

export function TaskHeader({ task, assistant }: { task: Task; assistant: Assistant }) {
  const actor = useActor()
  const t = useT()
  const query = useQueryClient()
  const suggest = useTagSuggest()
  const navigate = useNavigate()
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [reopen, setReopen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [complete, setComplete] = useState(false)
  const saving = useRef(false)
  const refresh = () => { void query.invalidateQueries({ queryKey: ['task', task.id] }); void query.invalidateQueries({ queryKey: ['tasks'] }) }

  async function commitTitle() {
    if (saving.current) return
    saving.current = true
    setEditingTitle(false)
    const next = title.trim()
    if (next && next !== task.title) {
      try { await setTaskTitle(task.id, next, 'manual'); refresh() }
      catch (error) { toast.error(error instanceof Error ? error.message : t('task.header.titleSaveFailed')) }
    } else setTitle(task.title)
    saving.current = false
  }
  async function changeStatus(status: TaskStatus, reason?: string) {
    try { await setTaskStatus(actor, task.id, status, reason ? { reason } : {}); refresh(); return true }
    catch (error) { toast.error(error instanceof Error ? error.message : t('task.header.statusFailed')); return false }
  }
  async function remove() {
    const result = await deleteTask(task.id)
    if (!result.ok) { toast.error(result.reason); return }
    navigate('/?view=kanban')
  }

  return <div className="border-b bg-card px-4 py-3">
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Link to={`/?view=kanban&assistant=${encodeURIComponent(assistant.id)}`} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-0.5 text-xs hover:bg-muted"><AssistantAvatar assistant={assistant} size="xs" /><span className="truncate">{assistant.name}</span></Link>
        <span className="font-mono text-xs text-muted-foreground">{task.code}</span>
        <TaskStatusBadge status={task.status} />
        <PriorityBadge priority={task.priority} />
      </div>
      <div className="flex shrink-0 items-center gap-1 self-end sm:ml-auto">
        {task.status === 'done' ? <Button size="sm" variant="outline" onClick={() => setReopen(true)}><PlayCircle data-icon="inline-start" />{t('task.header.reopen')}</Button> : <>
          {task.status === 'on_hold' ? <Button size="sm" variant="outline" onClick={() => void changeStatus('in_progress')}><PlayCircle data-icon="inline-start" />{t('task.header.resume')}</Button> : <Button size="sm" variant="outline" onClick={() => void changeStatus('on_hold')}><PauseCircle data-icon="inline-start" />{t('task.header.hold')}</Button>}
          <Button size="sm" onClick={() => setComplete(true)}><CheckCircle2 data-icon="inline-start" />{t('task.header.complete')}</Button>
        </>}
        <Button variant="ghost" size="icon" aria-label={t('task.header.deleteConversation')} onClick={() => setConfirmDelete(true)}><Trash2 /></Button>
      </div>
    </div>
    <div className="mt-2">{editingTitle ? <Input aria-label={t('task.header.titleLabel')} value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => void commitTitle()} onKeyDown={(event) => { if (event.key === 'Enter') void commitTitle(); if (event.key === 'Escape') { setTitle(task.title); setEditingTitle(false) } }} autoFocus className="h-8 text-base font-semibold" /> : <button type="button" className="max-w-full text-left text-base font-semibold break-words hover:underline" disabled={task.status === 'done'} onClick={() => { setTitle(task.title); setEditingTitle(true) }}>{task.title}</button>}
      {task.summary && <p className="mt-0.5 text-xs break-words text-muted-foreground">{task.summary}</p>}
    </div>
    <div className="mt-2"><TagInput tags={task.tags} suggest={suggest} readOnly={task.status === 'done'} onAdd={async (value) => { await addTag(actor, task.id, value); refresh() }} onRemove={async (value) => { await removeTag(actor, task.id, value); refresh() }} onChipClick={(value) => navigate(`/?view=kanban&tag=${encodeURIComponent(value)}`)} /></div>
    <div className="mt-2"><RelatedStrip task={task} /></div>
    <ReasonDialog open={reopen} onOpenChange={setReopen} title={t('task.header.reopenTitle')} description={t('task.header.reopenDescription')} confirmLabel={t('task.header.reopenConfirm')} onConfirm={(reason) => changeStatus('in_progress', reason)} />
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t('task.header.deleteTitle')} description={t('task.header.deleteDescription')} onConfirm={remove} />
    <TaskCompleteDialog task={task} open={complete} onOpenChange={setComplete} />
  </div>
}
