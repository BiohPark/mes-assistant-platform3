import { useT } from '@/i18n'
import { useQuery } from '@tanstack/react-query'
import { Filter, MessageSquarePlus, RotateCcw, Search, X } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { filterFromParams, filterToParams, isFiltering, kanbanColumns, stageOptions, tagKey, TASK_STATUSES, type KanbanFilter, type TaskStatus } from '@mes/domain'
import { listTasks, setTaskStatus } from '@/api/tasks'
import { useActor, useAssistants } from '@/app/hooks'
import { useTagSuggest } from '@/app/useTagSuggest'
import { useUiStore } from '@/app/uiStore'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { TagInput } from '@/components/TagInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TASK_STATUS_KEY } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { ConversationCard } from './ConversationCard'

const colId = (assistantId: string) => `kanban-col-${assistantId}`

/** 에이전트 순서의 대화 열. 필터 상태는 URL에 두어 같은 주소를 공유할 수 있다. */
export function ConversationKanban() {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const filter = filterFromParams(params)
  const actor = useActor()
  const suggest = useTagSuggest()
  const assistants = useAssistants()
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => listTasks() })
  const collapseEmpty = useUiStore((s) => s.kanbanCollapseEmpty)
  const setCollapseEmpty = useUiStore((s) => s.setKanbanCollapseEmpty)
  const update = (patch: Partial<KanbanFilter>) => setParams(filterToParams({ ...filter, ...patch }, params), { replace: true })
  const reset = () => setParams(filterToParams({ stages: [], statuses: [], tags: [], mine: false, q: '' }, params), { replace: true })
  const columns = kanbanColumns(assistants, tasks.data ?? [], filter, actor.userId)
  const stages = stageOptions(assistants)
  const focused = filter.assistantId ? assistants.find((a) => a.id === filter.assistantId) : undefined
  const total = columns.reduce((count, column) => count + column.tasks.length, 0)
  const toggleStage = (key: string) => update({ stages: filter.stages.includes(key) ? filter.stages.filter((value) => value !== key) : [...filter.stages, key] })
  const addFilterTag = (tag: string) => { if (!filter.tags.some((value) => tagKey(value) === tagKey(tag))) update({ tags: [...filter.tags, tag] }) }
  async function changeStatus(taskId: string, status: TaskStatus) {
    try { await setTaskStatus(actor, taskId, status); toast.success(`상태를 '${t(TASK_STATUS_KEY[status])}'(으)로 바꿨습니다.`) }
    catch (error) { toast.error(error instanceof Error ? error.message : '상태를 바꾸지 못했습니다') }
  }

  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-56"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={filter.q} onChange={(event) => update({ q: event.target.value })} placeholder="코드 · 제목 · 태그 검색" className="h-8 pl-8" /></div>
      <details className="relative"><summary className={cn('flex h-8 cursor-pointer items-center gap-1 rounded-lg border px-2 text-xs', filter.stages.length > 0 && 'border-primary text-primary')}><Filter className="size-3.5" />단계{filter.stages.length > 0 && ` ${filter.stages.length}`}</summary><div className="absolute z-20 mt-1 w-72 space-y-2 rounded-xl border bg-popover p-3 shadow-md"><div className="text-xs font-medium">업무 단계 (여러 개 선택)</div>{stages.map((group) => <div key={group.level1} className="space-y-1"><div className="text-xs text-muted-foreground">{group.level1}</div><div className="flex flex-wrap gap-1">{group.stages.map((stage) => <button key={stage.key} type="button" aria-pressed={filter.stages.includes(stage.key)} onClick={() => toggleStage(stage.key)} className={cn('rounded-full border px-2 py-0.5 text-xs', filter.stages.includes(stage.key) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>{stage.level2}</button>)}</div></div>)}</div></details>
      <ToggleGroup type="multiple" variant="outline" size="sm" value={filter.statuses} onValueChange={(values) => update({ statuses: values as TaskStatus[] })} aria-label="상태 필터" className="flex-wrap">{TASK_STATUSES.map((status) => <ToggleGroupItem key={status} value={status} className="text-xs">{t(TASK_STATUS_KEY[status])}</ToggleGroupItem>)}</ToggleGroup>
      <Label className="flex items-center gap-1.5 text-xs"><Switch checked={filter.mine} onCheckedChange={(mine) => update({ mine })} />내 대화</Label>
      <TagInput tags={filter.tags} suggest={suggest} onAdd={addFilterTag} onRemove={(tag) => update({ tags: filter.tags.filter((value) => value !== tag) })} placeholder="태그 필터" />
      {focused && <span className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs"><AssistantAvatar assistant={focused} size="xs" className="size-5 rounded-full text-xs" />{focused.name}<button type="button" aria-label="에이전트 필터 해제" onClick={() => update({ assistantId: undefined })}><X className="size-3" /></button></span>}
      <div className="ml-auto flex items-center gap-2"><Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Switch checked={collapseEmpty} onCheckedChange={setCollapseEmpty} />빈 열 접기</Label>{isFiltering(filter) && <Button size="sm" variant="ghost" onClick={reset}><RotateCcw data-icon="inline-start" />초기화</Button>}</div>
    </div>
    {tasks.isPending && <div className="text-sm text-muted-foreground">불러오는 중…</div>}
    {tasks.isError && <div role="alert" className="text-sm">대화 목록을 불러오지 못했습니다. <Button size="sm" variant="outline" onClick={() => void tasks.refetch()}>다시 시도</Button></div>}
    {!tasks.isError && <>
      <div className="flex items-center gap-1 overflow-x-auto pb-1" aria-label="열 이동"><span className="shrink-0 text-xs text-muted-foreground">대화 {total}</span>{columns.map((column) => <button key={column.assistant.id} type="button" title={`${column.assistant.name} (${column.tasks.length})`} onClick={() => document.getElementById(colId(column.assistant.id))?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })} className={cn('relative shrink-0 rounded-lg', column.tasks.length === 0 && 'opacity-40')}><AssistantAvatar assistant={column.assistant} size="xs" />{column.tasks.length > 0 && <span className="absolute -top-1 -right-1 rounded-full bg-foreground px-1 text-[11px] leading-4 text-background">{column.tasks.length}</span>}</button>)}</div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">{columns.map(({ assistant, tasks: columnTasks }) => collapseEmpty && columnTasks.length === 0 ? <div key={assistant.id} id={colId(assistant.id)} className="flex w-10 shrink-0 flex-col items-center gap-2 rounded-xl border border-dashed py-2" title={`${assistant.name} — 대화 없음`}><AssistantAvatar assistant={assistant} size="xs" /><span className="text-xs text-muted-foreground [writing-mode:vertical-rl]">{assistant.name}</span></div> : <section key={assistant.id} id={colId(assistant.id)} className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/40" aria-label={`${assistant.name} 열`}><header className="flex items-center gap-2 border-b px-2.5 py-2" style={{ borderTop: `3px solid ${assistant.color}`, borderRadius: '0.75rem 0.75rem 0 0' }}><AssistantAvatar assistant={assistant} size="xs" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{assistant.name}</div><div className="text-xs text-muted-foreground">{assistant.level1} › {assistant.level2}</div></div><span className="text-xs text-muted-foreground">{columnTasks.length}</span>{assistant.status !== 'retired' && <Button size="icon-xs" variant="ghost" asChild><Link to={`/new/${encodeURIComponent(assistant.id)}${filter.tags.length ? `?${filter.tags.map((tag) => `tag=${encodeURIComponent(tag)}`).join('&')}` : ''}`} aria-label={`${assistant.name} 새 대화`}><MessageSquarePlus /></Link></Button>}</header><div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">{columnTasks.length === 0 ? <div className="py-6 text-center text-xs text-muted-foreground">대화 없음</div> : columnTasks.map((task) => <ConversationCard key={task.id} task={task} onTagClick={addFilterTag} onStatusChange={(status) => void changeStatus(task.id, status)} />)}</div></section>)}</div>
    </>}
  </div>
}
