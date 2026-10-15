import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { ListTodo } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { taskPages, uniqueTasks } from '@/api/tasks.queries'
import { HttpError, useMe } from '@/app/auth'
import { TopBar } from '@/app/TopBar'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { EmptyState } from '@/components/EmptyState'
import { TaskStatusBadge } from '@/components/StatusBadges'
import { StalledIndicator } from '@/components/TaskListIndicators'
import { LinkedSrChip } from '@/components/LinkedSrChip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useT } from '@/i18n'
import { listAssistants } from '@/lib/catalog'
import { useDates } from '@/lib/dates'
import { TASK_STATUS_KEY } from '@/lib/labels'
import { useTablistKeys } from '@/lib/useTablistKeys'
import { useSearchText } from '@/features/home/useSearchText'
import { GROUPINGS, groupWork, type WorkGrouping } from './groups'

export function MyWorkPage() {
  const t = useT()
  const me = useMe()
  const dates = useDates()
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const completed = params.get('done') === '1'
  const grouping = GROUPINGS.includes(params.get('group') as WorkGrouping) ? params.get('group') as WorkGrouping : 'due'
  const query = params.get('q') ?? ''
  const [debounced, setDebounced] = useState(query)
  useEffect(() => { const timer = setTimeout(() => setDebounced(query), 200); return () => clearTimeout(timer) }, [query])
  const update = (key: string, value?: string) => setParams(prev => { const next = new URLSearchParams(prev); next.delete(key); if (value) next.set(key, value); return next }, { replace: key === 'q' })
  const search = useSearchText(query, value => update('q', value.trim()))
  const tasks = useInfiniteQuery(taskPages(me.id, { mine: true, status: completed ? ['done'] : ['todo', 'in_progress', 'on_hold'], q: debounced, limit: 30 }))
  useEffect(() => {
    if (tasks.error instanceof HttpError && tasks.error.status === 403) void client.invalidateQueries({ queryKey: ['me'] })
  }, [client, tasks.error])
  const catalog = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const assistants = new Map((catalog.data ?? []).map(assistant => [assistant.id, assistant]))
  const rows = uniqueTasks(tasks.data?.pages ?? [])
  const groups = groupWork(rows, grouping)
  // The server exposes activity cursors, so deadline/SR groups share that cursor.
  // A group reveals 30 rows at a time; additional server pages are always explicit.
  const [visible, setVisible] = useState<Record<string, number>>({})
  const scope = `${me.id}:${completed}:${debounced}:${grouping}`
  const failed = (tasks.isError && !tasks.data) || catalog.isError
  const loading = tasks.isPending || catalog.isPending
  const tabs = useTablistKeys(['active', 'done'] as const, completed ? 'done' : 'active', value => update('done', value === 'done' ? '1' : undefined))
  const groupLabel = (key: string) => grouping === 'due' ? t(`myWork.${key as 'overdue' | 'today' | 'week' | 'later' | 'none'}`) : grouping === 'status' ? t(TASK_STATUS_KEY[key as keyof typeof TASK_STATUS_KEY]) : grouping === 'assistant' ? assistants.get(key)?.name ?? t('myWork.unknownAssistant') : key === 'none' ? t('myWork.noSr') : key

  return <>
    <TopBar title={t('nav.myWork')} />
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <p className="text-sm text-muted-foreground">{t('myWork.description')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label={t('myWork.tabs')} data-tour="my-work-completed" className="inline-flex rounded-lg border p-1" {...tabs.tablistProps}>
            {(['active', 'done'] as const).map(value => <button key={value} type="button" {...tabs.tabProps(value)} onClick={() => update('done', value === 'done' ? '1' : undefined)} className="rounded-md px-3 py-1 text-sm aria-selected:bg-muted">{t(value === 'active' ? 'myWork.active' : 'myWork.completed')}</button>)}
          </div>
          <Input {...search} aria-label={t('myWork.search')} placeholder={t('myWork.search')} className="h-8 w-full sm:w-60" />
          <div className="flex items-center gap-2 text-sm">{t('myWork.groupBy')}<Select value={grouping} onValueChange={value => update('group', value === 'due' ? undefined : value)}><SelectTrigger aria-label={t('myWork.groupBy')}><SelectValue /></SelectTrigger><SelectContent>{GROUPINGS.map(value => <SelectItem key={value} value={value}>{t(`myWork.${value}`)}</SelectItem>)}</SelectContent></Select></div>
        </div>
        {grouping === 'sr' && <p className="text-xs text-muted-foreground">{t('myWork.srHint')}</p>}
        {failed ? <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm"><p>{t('myWork.loadFailed')}</p><Button variant="outline" size="sm" disabled={tasks.isFetching || catalog.isFetching} onClick={() => { void tasks.refetch(); void catalog.refetch() }}>{t('common.retry')}</Button></div>
          : loading ? <div role="status" aria-label={t('common.loading')} aria-busy="true" className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>
          : <>
            {rows.length ? <div data-tour="my-work-list" className="space-y-4">
              {groups.filter(group => group.items.length).map(group => {
                const count = visible[`${scope}:${group.key}`] ?? 30
                return <section key={group.key} aria-label={groupLabel(group.key)}>
                  <h2 className="mb-1 text-sm font-semibold">{groupLabel(group.key)}</h2>
                  <ul aria-label={t('myWork.list')} className="divide-y rounded-lg border bg-card">
                    {group.items.slice(0, count).map(task => {
                      const assistant = assistants.get(task.assistantId)
                      return <li key={task.id} className="min-w-0"><Link to={`/c/${task.id}`} aria-label={t('hub.openConversation', { code: task.code, title: task.title })} className="flex min-w-0 items-center gap-2 overflow-hidden px-3 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">{task.code}</span>
                        <TaskStatusBadge status={task.status} />
                        <StalledIndicator task={task} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={task.title}>{task.title}</span>
                        <LinkedSrChip interactive={false} codes={task.linkedSrCodes} />
                        <span className="hidden min-w-0 max-w-32 items-center gap-1 truncate text-xs text-muted-foreground md:inline-flex">{assistant && <AssistantAvatar assistant={assistant} size="xs" />}<span className="truncate">{assistant?.name ?? t('myWork.unknownAssistant')}</span></span>
                        {task.dueDate && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{task.dueDate.slice(0, 10)}</span>}
                        <time className="hidden shrink-0 text-xs text-muted-foreground lg:inline" dateTime={task.lastActivityAt} title={dates.formatDateTime(task.lastActivityAt)}>{dates.formatRelative(task.lastActivityAt)}</time>
                      </Link></li>
                    })}
                  </ul>
                  {(group.items.length > count || tasks.hasNextPage) && <Button variant="ghost" size="sm" disabled={tasks.isFetchingNextPage} onClick={() => {
                    setVisible(prev => ({ ...prev, [`${scope}:${group.key}`]: count + 30 }))
                    if (group.items.length <= count && tasks.hasNextPage) void tasks.fetchNextPage()
                  }}>{t('myWork.more')}</Button>}
                </section>
              })}
            </div> : <EmptyState icon={ListTodo} title={t('myWork.empty')} description={t('myWork.emptyDescription')} action={<Button asChild variant="outline" size="sm"><Link to="/">{t('myWork.goToHub')}</Link></Button>} />}
            {tasks.isError && <div role="alert" className="text-sm">{t('myWork.loadFailed')} <Button variant="outline" size="sm" onClick={() => tasks.isFetchNextPageError ? void tasks.fetchNextPage() : void tasks.refetch()}>{t('common.retry')}</Button></div>}
            {tasks.hasNextPage && <div className="space-y-2"><p className="text-xs text-muted-foreground">{t('myWork.loadedHint')}</p><Button variant="outline" size="sm" disabled={tasks.isFetchingNextPage} onClick={() => void tasks.fetchNextPage()}>{t(tasks.isFetchingNextPage ? 'common.loading' : 'myWork.more')}</Button></div>}
          </>}
      </div>
    </div>
  </>
}
