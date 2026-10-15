import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { CheckCircle2, ExternalLink, MoreHorizontal, PauseCircle, PlayCircle, Trash2 } from 'lucide-react'
import type { Task, TaskStatus } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSettings } from '@/api/admin'
import { addTag, deleteTask, removeTag, setTaskStatus } from '@/api/tasks'
import { useActor } from '@/app/hooks'
import { isPopout, openPopout } from '@/app/popout'
import { useSrStatus, useTagSuggest } from '@/app/useTagSuggest'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { OpenWebUiIcon } from '@/components/OpenWebUiIcon'
import { TagInput } from '@/components/TagInput'
import { ReasonDialog } from '@/components/ReasonDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PriorityBadge, TaskStatusBadge } from '@/components/StatusBadges'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useT } from '@/i18n'
import { assistantLink1 } from '@/lib/links'
import { QuickSwitch } from './QuickSwitch'
import { RelatedStrip } from './RelatedStrip'
import { TaskCompleteDialog } from './TaskCompleteDialog'

/**
 * 대화 헤더 둘째 줄(제목·코드는 상단 바의 TaskTitle 하나뿐): 에이전트·상태·우선순위·태그 … 도구 아이콘 · 보류/완료 · ⋯(삭제).
 * 모바일은 가로 스크롤 한 줄, 데스크톱은 줄바꿈. toolsRef 자리에는 ChatView가 검색·질문 목차 아이콘을 포털로 넣는다.
 */
export function TaskHeader({ task, assistant, toolsRef }: { task: Task; assistant: Assistant; toolsRef?: (element: HTMLDivElement | null) => void }) {
  const actor = useActor()
  const t = useT()
  const query = useQueryClient()
  const suggest = useTagSuggest()
  const srStatus = useSrStatus()
  const navigate = useNavigate()
  // 사내 어시스턴트 바로가기 — 초안 화면(DraftConversationPage)과 같은 규칙: 저장된 링크 → 설정 규칙 → baseUrl, 없으면 숨김
  const link1Rule = useQuery({ queryKey: ['settings'], queryFn: getSettings }).data?.link1Rule
  const link1 = assistantLink1('', assistant, link1Rule)
  const [reopen, setReopen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [complete, setComplete] = useState(false)
  const refresh = () => { void query.invalidateQueries({ queryKey: ['task', task.id] }); void query.invalidateQueries({ queryKey: ['tasks'] }) }

  async function changeStatus(status: TaskStatus, reason?: string) {
    try { await setTaskStatus(actor, task.id, status, reason ? { reason } : {}); refresh(); return true }
    catch (error) { toast.error(error instanceof Error ? error.message : t('task.header.statusFailed')); return false }
  }
  async function remove() {
    const result = await deleteTask(task.id)
    if (!result.ok) { toast.error(result.reason); return }
    navigate('/?view=kanban')
  }

  return <div className="border-b bg-card px-4 py-2">
    <div className="flex items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible">
      <Link to={`/?view=kanban&assistant=${encodeURIComponent(assistant.id)}`} className="inline-flex max-w-48 shrink-0 items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-0.5 text-xs hover:bg-muted sm:max-w-64"><AssistantAvatar assistant={assistant} size="xs" /><span className="truncate">{assistant.name}</span></Link>
      <TaskStatusBadge status={task.status} />
      <PriorityBadge priority={task.priority} />
      <TagInput compact data-tour="tags" className="shrink-0 flex-nowrap sm:flex-wrap" tags={task.tags} suggest={suggest} srStatus={srStatus} readOnly={task.status === 'done'} onAdd={async (value) => { await addTag(actor, task.id, value); refresh() }} onRemove={async (value) => { await removeTag(actor, task.id, value); refresh() }} onChipClick={(value) => navigate(`/?view=kanban&tag=${encodeURIComponent(value)}`)} />
      {task.tags.length > 0 && <div className="shrink-0"><RelatedStrip tags={task.tags} excludeTaskId={task.id} /></div>}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <div ref={toolsRef} className="flex items-center gap-1 empty:hidden data-[chat-hidden=true]:max-lg:hidden" />
        <QuickSwitch currentTaskId={task.id} />
        {link1 && <Button variant="ghost" size="icon" asChild className="relative text-muted-foreground after:absolute after:-inset-1.5"><a href={link1} target="_blank" rel="noreferrer" aria-label={t('chat.openWebUi')} title={t('chat.openWebUi')}><OpenWebUiIcon /></a></Button>}
        {/* 새 창으로 띄우기 — 메뉴(onSelect)가 아니라 버튼 onClick 이어야 사용자 제스처로 인정돼 팝업이 덜 막힌다. 막히면 같은 탭으로 가지 않고 토스트. 팝업 안에서는 없다 */}
        {!isPopout() && <Button variant="ghost" size="icon" data-tour="popout" className="relative text-muted-foreground after:absolute after:-inset-1.5" aria-label={t('task.header.popout')} title={t('task.header.popout')} onClick={() => { if (!openPopout(task.id)) toast.error(t('task.header.popoutBlocked')) }}><ExternalLink aria-hidden /></Button>}
        {task.status === 'done' ? <Button size="sm" variant="outline" onClick={() => setReopen(true)}><PlayCircle data-icon="inline-start" />{t('task.header.reopen')}</Button> : <>
          {task.status === 'on_hold' ? <Button size="sm" variant="outline" data-tour="task-hold" onClick={() => void changeStatus('in_progress')}><PlayCircle data-icon="inline-start" />{t('task.header.resume')}</Button> : <Button size="sm" variant="outline" data-tour="task-hold" onClick={() => void changeStatus('on_hold')}><PauseCircle data-icon="inline-start" />{t('task.header.hold')}</Button>}
          <Button size="sm" data-tour="task-complete" onClick={() => setComplete(true)}><CheckCircle2 data-icon="inline-start" />{t('task.header.complete')}</Button>
        </>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t('task.header.more')} title={t('task.header.more')}><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}><Trash2 />{t('task.header.deleteConversation')}</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    {task.summary && <p className="mt-1 truncate text-xs text-muted-foreground" title={task.summary}>{task.summary}</p>}
    <ReasonDialog open={reopen} onOpenChange={setReopen} title={t('task.header.reopenTitle')} description={t('task.header.reopenDescription')} confirmLabel={t('task.header.reopenConfirm')} onConfirm={(reason) => changeStatus('in_progress', reason)} />
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t('task.header.deleteTitle')} description={t('task.header.deleteDescription')} onConfirm={remove} />
    <TaskCompleteDialog task={task} open={complete} onOpenChange={setComplete} />
  </div>
}
