import { useEffect, useState, type RefObject } from 'react'
import { useT } from '@/i18n'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Check, Filter, MessageSquarePlus, RotateCcw, Search, X } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { filterFromParams, filterToParams, isFiltering, stageKey, stageOptions, tagKey, TASK_STATUSES, type KanbanFilter, type TaskSummary, type TaskPage, type TaskStatus } from '@mes/domain'
import { setTaskStatus, type TaskFilter } from '@/api/tasks'
import { taskBoard, taskPages, uniqueTasks } from '@/api/tasks.queries'
import { useActor } from '@/app/hooks'
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
import { listAssistants } from '@/lib/catalog'
import { EmptyState } from '@/components/EmptyState'
import { FILTER_TOGGLE_CLASS } from './CardMapFilterBar'
import { ConversationCard } from './ConversationCard'
import { AI_FILTERS, aiFilterFromParams, aiFilterToParams, type AiFilter } from './filters'
import { useSearchText } from './useSearchText'

const colId = (assistantId: string) => `kanban-col-${assistantId}`

/** 에이전트 순서의 대화 열. 필터 상태는 URL에 두어 같은 주소를 공유할 수 있다. */
export function ConversationKanban({ pendingSearch }: { pendingSearch: RefObject<string | undefined> }) {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const actor = useActor()
  const suggest = useTagSuggest()
  const catalog = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const assistants = catalog.data ?? []
  const filter = filterFromParams(params, catalog.data)
  const aiFilter = aiFilterFromParams(params)
  const latestFilter = (prev: URLSearchParams) => {
    const latest = filterFromParams(prev, catalog.data)
    return { ...latest, q: pendingSearch.current ?? latest.q }
  }
  const rawStages = params.getAll('stage').join('\u0000')
  const stagesKey = filter.stages.join('\u0000')
  useEffect(() => {
    if (!catalog.data || rawStages === stagesKey) return
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('stage')
      filterFromParams(prev, catalog.data).stages.forEach(stage => next.append('stage', stage))
      if (pendingSearch.current !== undefined) {
        next.delete('q')
        if (pendingSearch.current) next.set('q', pendingSearch.current)
      }
      return next
    }, { replace: true })
  }, [catalog.data, rawStages, stagesKey, setParams])
  const rememberedDone = useUiStore(s => s.kanbanCompleted[actor.userId] ?? false)
  const includeCompleted = filter.statuses.includes('done') || (params.has('done') ? params.get('done') === '1' : rememberedDone)
  const setCompleted = useUiStore(s => s.setKanbanCompleted)
  const apiFilter: TaskFilter = { assistantId: filter.assistantId, status: filter.statuses.length ? filter.statuses : includeCompleted ? undefined : ['todo', 'in_progress', 'on_hold'], tags: filter.tags, mine: filter.mine, q: filter.q, ai: aiFilter, limit: 30 }
  const tasks = useQuery(taskBoard(actor.userId, apiFilter))
  const [boardRevision, setBoardRevision] = useState(0)
  // Phase-only cache patches keep loaded pages. A completed HTTP refresh reseeds columns.
  useEffect(() => { if (!tasks.isFetching) setBoardRevision(tasks.dataUpdatedAt) }, [tasks.isFetching])
  const collapseEmpty = useUiStore((s) => s.kanbanCollapseEmpty)
  const setCollapseEmpty = useUiStore((s) => s.setKanbanCollapseEmpty)
  const update = (patch: Partial<KanbanFilter>) => {
    if (patch.q !== undefined) pendingSearch.current = patch.q.trim()
    setParams(prev => filterToParams({ ...latestFilter(prev), ...patch }, prev), { replace: patch.q !== undefined })
  }
  const updateAi = (values: AiFilter[]) => setParams(prev => filterToParams(latestFilter(prev), aiFilterToParams(values, prev)))
  const search = useSearchText(filter.q, q => update({ q }), value => value.trim())
  const clearFilters = () => setParams(prev => filterToParams({ stages: [], statuses: [], tags: [], mine: false, q: latestFilter(prev).q }, aiFilterToParams([], prev)))
  const reset = () => {
    pendingSearch.current = ''
    setParams(prev => filterToParams({ stages: [], statuses: [], tags: [], mine: false, q: '' }, aiFilterToParams([], prev)))
  }
  const filtering = isFiltering(filter) || aiFilter.length > 0
  const counts = new Map((tasks.data?.columns ?? []).map(column => [column.assistantId, column]))
  const columns = [...assistants].sort((a, b) => a.order - b.order)
    .filter(a => !filter.assistantId || a.id === filter.assistantId)
    .filter(a => !filter.stages.length || (a.classifications ?? [a]).some(path => filter.stages.includes(stageKey(path))))
    .filter(a => a.status !== 'retired' || !!counts.get(a.id)?.total)
    .map(assistant => ({ assistant, page: counts.get(assistant.id) ?? { items: [], total: 0, nextCursor: null } }))
  const stages = stageOptions(assistants)
  const focused = filter.assistantId ? assistants.find((a) => a.id === filter.assistantId) : undefined
  const selectedCount = filter.stages.length + filter.statuses.length + filter.tags.length + Number(filter.mine) + Number(!!filter.assistantId) + aiFilter.length
  const total = columns.reduce((count, column) => count + column.page.total, 0)
  const toggleStage = (key: string) => update({ stages: filter.stages.includes(key) ? filter.stages.filter((value) => value !== key) : [...filter.stages, key] })
  const addFilterTag = (tag: string) => { if (!filter.tags.some((value) => tagKey(value) === tagKey(tag))) update({ tags: [...filter.tags, tag] }) }
  async function changeStatus(taskId: string, status: TaskStatus) {
    try { await setTaskStatus(actor, taskId, status); toast.success(t('hub.statusChanged', { status: t(TASK_STATUS_KEY[status]) })) }
    catch (error) { toast.error(error instanceof Error ? error.message : t('hub.statusChangeFailed')) }
  }

  const firstCardId = columns.find(column => column.page.items.length > 0)?.page.items[0]?.id // 가이드 투어가 짚는 카드 하나
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2" data-tour="kanban-filters">
      <div className="relative w-full sm:w-56"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input {...search} placeholder={t('hub.searchConversations')} className="h-8 pl-8" /></div>
      <details className="relative"><summary className={cn('flex h-8 cursor-pointer items-center gap-1 rounded-lg border px-2 text-xs', filter.stages.length > 0 && 'border-primary text-primary')}><Filter className="size-3.5" />{t('hub.stage')}{filter.stages.length > 0 && ` ${filter.stages.length}`}</summary><div className="absolute z-20 mt-1 w-72 space-y-2 rounded-xl border bg-popover p-3 shadow-md"><div className="text-xs font-medium">{t('hub.stagesTitle')}</div>{stages.map((group) => <div key={group.level1} className="space-y-1"><div className="text-xs text-muted-foreground">{group.level1}</div><div className="flex flex-wrap gap-1">{group.stages.map((stage) => <button key={stage.key} type="button" aria-pressed={filter.stages.includes(stage.key)} onClick={() => toggleStage(stage.key)} className={cn('rounded-full border px-2 py-0.5 text-xs border-muted-foreground/30 hover:border-foreground disabled:opacity-50', filter.stages.includes(stage.key) && 'bg-primary text-primary-foreground font-semibold')}>{filter.stages.includes(stage.key) && <Check aria-hidden className="mr-1 inline size-3" />}{stage.level2}</button>)}</div></div>)}</div></details>
      <ToggleGroup type="multiple" variant="outline" size="sm" value={filter.statuses} onValueChange={(values) => update({ statuses: values as TaskStatus[] })} aria-label={t('hub.statusFilter')} className="flex-wrap">{TASK_STATUSES.map((status) => <ToggleGroupItem key={status} value={status} className={`${FILTER_TOGGLE_CLASS} text-xs`}>{filter.statuses.includes(status) && <Check aria-hidden className="size-3" />}{t(TASK_STATUS_KEY[status])}</ToggleGroupItem>)}</ToggleGroup>
      <ToggleGroup type="multiple" variant="outline" size="sm" data-tour="kanban-ai-filter" value={aiFilter} onValueChange={(values) => updateAi(values as AiFilter[])} aria-label={t('hub.aiFilter')} className="flex-wrap">{AI_FILTERS.map((value) => <ToggleGroupItem key={value} value={value} className={`${FILTER_TOGGLE_CLASS} text-xs`}>{aiFilter.includes(value) && <Check aria-hidden className="size-3" />}{t(value === 'responding' ? 'hub.aiResponding' : 'hub.aiFailedFilter')}</ToggleGroupItem>)}</ToggleGroup>
      <Label className="flex items-center gap-1.5 text-xs"><Switch checked={filter.mine} onCheckedChange={(mine) => update({ mine })} />{t('hub.mine')}</Label>
      <Label className="flex items-center gap-1.5 text-xs"><Switch checked={includeCompleted} onCheckedChange={value => { setCompleted(actor.userId, value); setParams(prev => { const latest = latestFilter(prev); const next = filterToParams({ ...latest, statuses: value ? latest.statuses : latest.statuses.filter(status => status !== 'done') }, prev); next.set('done', value ? '1' : '0'); return next }) }} />{t('myWork.includeCompleted')}</Label>
      <TagInput tags={filter.tags} suggest={suggest} onAdd={addFilterTag} onRemove={(tag) => update({ tags: filter.tags.filter((value) => value !== tag) })} placeholder={t('hub.tagFilter')} />
      {focused && <span className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs"><AssistantAvatar assistant={focused} size="xs" className="size-5 rounded-full text-xs" />{focused.name}<button type="button" aria-label={t('hub.clearAssistantFilter')} onClick={() => update({ assistantId: undefined })}><X className="size-3" /></button></span>}
      <div className="ml-auto flex items-center gap-2"><Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Switch checked={collapseEmpty} onCheckedChange={setCollapseEmpty} />{t('hub.collapseEmpty')}</Label><span className="text-xs text-muted-foreground">{t('hub.selectedCount', { count: selectedCount })}</span>{filtering && <Button size="sm" variant="ghost" onClick={reset}><RotateCcw data-icon="inline-start" />{t('hub.reset')}</Button>}</div>
    </div>
    {tasks.isPending && <div className="text-sm text-muted-foreground">{t('common.loading')}</div>}
    {tasks.isError && <div role="alert" className="text-sm">{t('hub.listFailed')} <Button size="sm" variant="outline" onClick={() => void tasks.refetch()}>{t('common.retry')}</Button></div>}
    {!tasks.isError && <>
      {tasks.data && total === 0 && filtering && <EmptyState icon={Filter} title={t('hub.noMatchingConversations')} action={<div className="flex gap-2">
        {!!filter.q && <Button size="sm" variant="outline" onClick={() => update({ q: '' })}>{t('hub.clearSearch')}</Button>}
        {selectedCount > 0 && <Button size="sm" variant="outline" onClick={clearFilters}>{t('hub.clearFilters', { count: selectedCount })}</Button>}
      </div>} />}
      <div className="flex items-center gap-1 overflow-x-auto pb-1" aria-label={t('hub.jumpToColumn')}><span className="shrink-0 text-xs text-muted-foreground">{t('hub.conversationCount', { count: total })}</span>{columns.map((column) => <button key={column.assistant.id} type="button" title={`${column.assistant.name} (${column.page.total})`} onClick={() => document.getElementById(colId(column.assistant.id))?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })} className={cn('flex shrink-0 items-center gap-1 rounded-full border bg-card p-0.5 pr-1.5 hover:bg-muted', column.page.total === 0 && 'opacity-40')}><AssistantAvatar assistant={column.assistant} size="xs" className="size-5 text-[11px]" /><span className="text-[11px] leading-4 tabular-nums text-muted-foreground">{column.page.total}</span></button>)}</div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2" data-tour="kanban-columns">{columns.map(({ assistant, page }) => collapseEmpty && page.total === 0 ? <div key={assistant.id} id={colId(assistant.id)} className="flex w-10 shrink-0 flex-col items-center gap-2 rounded-xl border border-dashed py-2" title={t('hub.emptyColumnTitle', { name: assistant.name })}><AssistantAvatar assistant={assistant} size="xs" /><span className="text-xs text-muted-foreground [writing-mode:vertical-rl]">{assistant.name}</span></div> : <section key={assistant.id} id={colId(assistant.id)} className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/40" aria-label={t('hub.columnLabel', { name: assistant.name })}><header className="flex items-center gap-2 border-b px-2.5 py-2" style={{ borderTop: `3px solid ${assistant.color}`, borderRadius: '0.75rem 0.75rem 0 0' }}><AssistantAvatar assistant={assistant} size="xs" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{assistant.name}</div><div className="text-xs text-muted-foreground">{assistant.level1} › {assistant.level2}{(assistant.classifications?.length ?? 1) > 1 && ` +${assistant.classifications!.length - 1}`}</div></div><span className="text-xs text-muted-foreground">{page.total}</span>{assistant.status !== 'retired' && <Button size="icon-xs" variant="ghost" asChild><Link state={{ tagPreset: true }} to={`/new/${encodeURIComponent(assistant.id)}${filter.tags.length ? `?${filter.tags.map((tag) => `tag=${encodeURIComponent(tag)}`).join('&')}` : ''}`} aria-label={t('hub.newConversationIn', { name: assistant.name })}><MessageSquarePlus /></Link></Button>}</header><ColumnItems key={`${assistant.id}:${boardRevision}`} revision={boardRevision} userId={actor.userId} filter={{ ...apiFilter, assistantId: assistant.id }} page={page} firstCardId={firstCardId} onTagClick={addFilterTag} onStatusChange={changeStatus} /></section>)}</div>
    </>}
  </div>
}

/** Board seeds the first 30 cards. Only the selected column requests a continuation. */
function ColumnItems({ revision, userId, filter, page, firstCardId, onTagClick, onStatusChange }: {
  revision: number; userId: string; filter: TaskFilter; page: TaskPage; firstCardId?: string;
  onTagClick: (tag: string) => void; onStatusChange: (id: string, status: TaskStatus) => Promise<void>
}) {
  const t = useT()
  const tasks = useInfiniteQuery({ ...taskPages(userId, filter), queryKey: ['tasks', userId, 'board-column', filter, revision],
    initialData: { pages: [page], pageParams: [undefined] }, enabled: false, gcTime: 0 })
  const items: TaskSummary[] = uniqueTasks(tasks.data.pages)
  return <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
    {items.length ? items.map(task => <ConversationCard key={task.id} task={task} data-tour={task.id === firstCardId ? 'kanban-card' : undefined} onTagClick={onTagClick} onStatusChange={status => void onStatusChange(task.id, status)} />) : <div className="py-6 text-center text-xs text-muted-foreground">{t('hub.noConversations')}</div>}
    {tasks.isFetchNextPageError && <div role="alert" className="text-xs">{t('hub.listFailed')}</div>}
    {tasks.hasNextPage && <Button variant="outline" size="sm" className="w-full" disabled={tasks.isFetchingNextPage} onClick={() => void tasks.fetchNextPage()}>{t(tasks.isFetchNextPageError ? 'common.retry' : tasks.isFetchingNextPage ? 'common.loading' : 'myWork.more')}</Button>}
  </div>
}
