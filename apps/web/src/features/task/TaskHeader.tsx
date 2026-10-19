import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { CheckCircle2, ExternalLink, MoreHorizontal, PauseCircle, PlayCircle, Trash2 } from 'lucide-react'
import { isSrTag, tagKey, type Task, type TaskStatus } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSettings } from '@/api/admin'
import { addTag, deleteTask, removeTag, setTaskStatus, updateTask } from '@/api/tasks'
import { useActor } from '@/app/hooks'
import { isPopout, openPopout } from '@/app/popout'
import { useSrStatus, useTagSuggest } from '@/app/useTagSuggest'
import { useOpenSr } from '@/app/useOpenSr'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { OpenWebUiIcon } from '@/components/OpenWebUiIcon'
import { TagInput } from '@/components/TagInput'
import { TagChip } from '@/components/TagChip'
import { ReasonDialog } from '@/components/ReasonDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PriorityBadge, TaskStatusBadge } from '@/components/StatusBadges'
import { PRIORITY_KEY } from '@/lib/labels'
import { copyText } from '@/lib/clipboard'
import { useMaterialCandidates } from '@/features/chat/useMaterialCandidates'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import { useT } from '@/i18n'
import { assistantLink1 } from '@/lib/links'
import { QuickSwitch } from './QuickSwitch'
import { TaskTitle } from './TaskTitle'
import { drawerId, hasContext, useDrawerOpen, useMaterialsDrawer } from './materialsDrawer'
import { useTaskChatActions } from './chatActions'
import { changeTagWithShare } from './tagShare'
import { TaskCompleteDialog } from './TaskCompleteDialog'

/** 제목·태그·핵심 동작은 한 줄, 관리와 보조 기능은 더 보기 메뉴로 연다. */
export function TaskHeader({ task, assistant, toolsRef }: { task: Task; assistant: Assistant; toolsRef?: (element: HTMLDivElement | null) => void }) {
  const openingTool = useRef(false)
  const panelOpen = useDrawerOpen(task)
  const choosePanel = useMaterialsDrawer(s => s.choose)
  const chatActions = useTaskChatActions(s => s.byTask[task.id])
  const contextual = hasContext(task)
  const { count } = useMaterialCandidates(task.id, false)
  const actor = useActor()
  const t = useT()
  const query = useQueryClient()
  const suggest = useTagSuggest()
  const srStatus = useSrStatus()
  const navigate = useNavigate()
  const openSr = useOpenSr()
  // 연결 SR 중 태그로 이미 보이지 않는 것(시작한 SR의 태그를 뗀 경우)만 따로 칩으로 — 태그 SR 칩도 같은 원클릭
  const startedSrs = (task.linkedSrCodes ?? []).filter((code) => !task.tags.some((value) => tagKey(value) === tagKey(code)))
  // 사내 어시스턴트 바로가기 — 초안 화면(DraftConversationPage)과 같은 규칙: 저장된 링크 → 설정 규칙 → baseUrl, 없으면 숨김
  const link1Rule = useQuery({ queryKey: ['settings'], queryFn: getSettings }).data?.link1Rule
  const link1 = assistantLink1('', assistant, link1Rule)
  const [reopen, setReopen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [complete, setComplete] = useState(false)
  const refresh = () => { void query.invalidateQueries({ queryKey: ['task', task.id] }); void query.invalidateQueries({ queryKey: ['tasks'] }) }
  const removeTaskTag = async (value: string) => { await changeTagWithShare(query, task.id, () => removeTag(actor, task.id, value)); refresh() }
  // #태그 칩 메뉴(S15 R3) — 칩은 TagInput 안에서 그려지므로 클릭된 칩 버튼을 기억해 팝오버의 기준점으로 쓴다
  const tagsRef = useRef<HTMLDivElement>(null)
  const clicked = useRef<HTMLElement | null>(null)
  const [tagMenu, setTagMenu] = useState<{ tag: string; anchor: HTMLElement } | null>(null)
  const tagChipButtons = () => [...(tagsRef.current?.querySelectorAll<HTMLElement>('[data-slot="chip"] > button[title]') ?? [])].filter(button => !isSrTag(button.getAttribute('aria-label') ?? ''))
  useEffect(() => { for (const button of tagChipButtons()) { button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', String(button === tagMenu?.anchor)) } })
  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null
    if (next === null || !items.length) return
    event.preventDefault()
    items[(next + items.length) % items.length]!.focus()
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

  return <div className="border-b bg-card px-4 py-2">
    <div className="flex items-center gap-2 flex-nowrap overflow-x-auto">
      <Link to={`/?view=kanban&assistant=${encodeURIComponent(assistant.id)}`} className="inline-flex max-w-48 shrink-0 items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-0.5 text-xs hover:bg-muted sm:max-w-64"><AssistantAvatar assistant={assistant} size="xs" /><span className="truncate">{assistant.name}</span></Link>
      <div className="min-w-32 flex-1"><TaskTitle key={task.id} task={task} /></div>
      {startedSrs.map((code) => <TagChip key={code} tag={code} className="shrink-0" onSrClick={(value) => void openSr(value)} />)}
      <div ref={tagsRef} className="contents" onClickCapture={event => { clicked.current = (event.target as Element).closest('button') }}><TagInput compact data-tour="tags" className="shrink-0 flex-nowrap" tags={task.tags} suggest={(prefix, exclude) => suggest(prefix, exclude).slice(0, 5)} srStatus={srStatus} readOnly={task.status === 'done'} onAdd={async (value) => { await changeTagWithShare(query, task.id, () => addTag(actor, task.id, value)); refresh() }} onRemove={removeTaskTag} onChipClick={(value) => { const anchor = clicked.current; if (anchor) setTagMenu(current => current?.anchor === anchor ? null : { tag: value, anchor }) }} onSrChipClick={(value) => void openSr(value)} /></div>
      <Popover open={!!tagMenu} onOpenChange={open => { if (!open) setTagMenu(null) }}>
        {tagMenu && <PopoverAnchor virtualRef={{ current: tagMenu.anchor }} />}
        {tagMenu && <PopoverContent align="start" role="menu" aria-label={t('task.header.tagMenu', { value: tagMenu.tag })} className="w-auto min-w-44 p-1" onKeyDown={moveFocus}
          onOpenAutoFocus={event => { event.preventDefault(); (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[role="menuitem"]')?.focus() }}
          onCloseAutoFocus={event => { event.preventDefault(); if (tagMenu.anchor.isConnected) tagMenu.anchor.focus() }}
          onInteractOutside={event => { if (tagMenu.anchor.contains(event.target as Node)) event.preventDefault() }}>
          {/* 그 태그 문자열만 넘긴다 — 파일·이전 대화는 새 대화의 자료 패널에 후보로만 보인다(자동 첨부 없음). 같은 에이전트로 시작 */}
          <TagMenuItem onClick={() => { setTagMenu(null); navigate(`/new/${encodeURIComponent(assistant.id)}?tag=${encodeURIComponent(tagMenu.tag)}`, { state: { tagPreset: true } }) }}>{t('task.header.tagNewConversation')}</TagMenuItem>
          <TagMenuItem onClick={() => { setTagMenu(null); navigate(`/?view=kanban&tag=${encodeURIComponent(tagMenu.tag)}`) }}>{t('task.header.tagViewConversations')}</TagMenuItem>
          {task.status !== 'done' && <TagMenuItem onClick={() => { const { tag } = tagMenu; setTagMenu(null); void removeTaskTag(tag).catch(error => toast.error(error instanceof Error && error.message ? error.message : t('components.tagSaveFailed'))) }}>{t('task.header.tagRemove')}</TagMenuItem>}
        </PopoverContent>}
      </Popover>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <div ref={toolsRef} className="flex items-center gap-1 empty:hidden data-[chat-hidden=true]:max-lg:hidden" />
        <QuickSwitch currentTaskId={task.id} />
        {link1 && <Button variant="ghost" size="icon" asChild className="relative text-muted-foreground after:absolute after:-inset-1.5"><a href={link1} target="_blank" rel="noreferrer" aria-label={t('chat.openWebUi')} title={t('chat.openWebUi')}><OpenWebUiIcon /></a></Button>}
        {/* 새 창으로 띄우기 — 메뉴(onSelect)가 아니라 버튼 onClick 이어야 사용자 제스처로 인정돼 팝업이 덜 막힌다. 막히면 같은 탭으로 가지 않고 토스트. 팝업 안에서는 없다 */}
        {!isPopout() && <Button variant="ghost" size="icon" data-tour="popout" className="relative text-muted-foreground after:absolute after:-inset-1.5" aria-label={t('task.header.popout')} title={t('task.header.popout')} onClick={() => { if (!openPopout(task.id)) toast.error(t('task.header.popoutBlocked')) }}><ExternalLink aria-hidden /></Button>}
        {task.status === 'done' ? <Button size="sm" variant="outline" onClick={() => setReopen(true)}><PlayCircle data-icon="inline-start" />{t('task.header.reopen')}</Button> : <>
          <Button size="sm" data-tour="task-complete" onClick={() => setComplete(true)}><CheckCircle2 data-icon="inline-start" />{t('task.header.complete')}</Button>
        </>}
        <Button variant="outline" size="sm" data-tour="linked-materials" aria-expanded={panelOpen} aria-controls={drawerId(task.id)} onClick={() => choosePanel(task.id, panelOpen ? 'closed' : 'open')}>{contextual || count ? t('task.header.materials', { count }) : t('task.body.materials')}</Button>
        {chatActions?.issue && <>
          <Button size="sm" variant="outline" disabled={!chatActions.info} onClick={chatActions.info}>{t('task.header.requestHistory')}</Button>
          <Button size="sm" variant="outline" disabled={!chatActions.exclude} onClick={chatActions.exclude}>{t('chat.retryWithoutFiles')}</Button>
          <Button size="sm" variant="outline" disabled={!chatActions.inline} onClick={chatActions.inline}>{t('chat.retryAsText')}</Button>
        </>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" data-tour="task-more" aria-label={t('task.header.more')} title={t('task.header.more')}><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56" onCloseAutoFocus={event => { if (openingTool.current) { event.preventDefault(); openingTool.current = false } }}>
            <DropdownMenuLabel>{t('task.body.tools')}</DropdownMenuLabel>
            {(['checklist', 'notes', 'history'] as const).map(tool => <DropdownMenuItem key={tool} onSelect={() => { openingTool.current = true; choosePanel(task.id, 'open', tool, true) }}>{t(`task.header.open_${tool}`)}</DropdownMenuItem>)}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2"><TaskStatusBadge status={task.status} /><PriorityBadge priority={task.priority} /></DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => { void copyText(task.code).then(ok => { if (!ok) toast.error(t('chat.copyMessageFailed')) }) }}>{t('task.header.copyCode')} · <span className="font-mono">{task.code}</span></DropdownMenuItem>
            <DropdownMenuLabel>{t('task.header.priority')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={task.priority} onValueChange={value => { void updateTask(task.id, { priority: value as Task['priority'] }).then(refresh).catch(error => toast.error(String(error))) }}>
              {(['low', 'normal', 'high', 'urgent'] as const).map(value => <DropdownMenuRadioItem key={value} value={value} disabled={task.status === 'done'}>{t(PRIORITY_KEY[value])}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
            {task.status !== 'done' && <DropdownMenuItem onSelect={() => void changeStatus(task.status === 'on_hold' ? 'in_progress' : 'on_hold')}>{task.status === 'on_hold' ? <PlayCircle /> : <PauseCircle />}{t(task.status === 'on_hold' ? 'task.header.resume' : 'task.header.hold')}</DropdownMenuItem>}
            {chatActions?.issue && <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!chatActions?.info} onSelect={chatActions?.info}>{t('task.header.requestHistory')}</DropdownMenuItem>
            <DropdownMenuItem disabled={!chatActions?.exclude} onSelect={chatActions?.exclude}>{t('chat.retryWithoutFiles')}</DropdownMenuItem>
            <DropdownMenuItem disabled={!chatActions?.inline} onSelect={chatActions?.inline}>{t('chat.retryAsText')}</DropdownMenuItem>
            </>}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}><Trash2 />{t('task.header.deleteConversation')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    <ReasonDialog open={reopen} onOpenChange={setReopen} title={t('task.header.reopenTitle')} description={t('task.header.reopenDescription')} confirmLabel={t('task.header.reopenConfirm')} onConfirm={(reason) => changeStatus('in_progress', reason)} />
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t('task.header.deleteTitle')} description={t('task.header.deleteDescription')} onConfirm={remove} />
    <TaskCompleteDialog task={task} open={complete} onOpenChange={setComplete} />
  </div>
}

function TagMenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted">{children}</button>
}
