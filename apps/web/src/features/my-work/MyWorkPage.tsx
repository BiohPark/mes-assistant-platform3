import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ListTodo } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { listTasks } from '@/api/tasks'
import { HttpError, useMe } from '@/app/auth'
import { TopBar } from '@/app/TopBar'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { EmptyState } from '@/components/EmptyState'
import { TaskStatusBadge } from '@/components/StatusBadges'
import { TagChip } from '@/components/TagChip'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useT } from '@/i18n'
import { listAssistants } from '@/lib/catalog'
import { useDates } from '@/lib/dates'
import { StalledBadge } from '@/features/task/StalledBadge'
import { sameParams } from '@/features/home/filters'

function completedParams(params: URLSearchParams, includeCompleted = params.get('done') === '1') {
  const next = new URLSearchParams(params)
  next.delete('done')
  if (includeCompleted) next.set('done', '1')
  return next
}

export function MyWorkPage() {
  const t = useT()
  const me = useMe()
  const dates = useDates()
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const includeCompleted = params.get('done') === '1'
  const normalized = sameParams(completedParams(params), params)
  useEffect(() => {
    if (!normalized) setParams(prev => completedParams(prev), { replace: true })
  }, [normalized, setParams])
  const setIncludeCompleted = (checked: boolean) => setParams(prev => completedParams(prev, checked))
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => listTasks() })
  useEffect(() => {
    if (tasks.error instanceof HttpError && tasks.error.status === 403) void client.invalidateQueries({ queryKey: ['me'] })
  }, [client, tasks.error])
  const catalog = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const assistants = new Map((catalog.data ?? []).map(assistant => [assistant.id, assistant]))
  // Same mine rule as domain/kanban: owner or participant; creating a conversation alone does not qualify.
  const rows = (tasks.data ?? [])
    .filter(task => (task.ownerId === me.id || task.assigneeIds.includes(me.id)) && (includeCompleted || task.status !== 'done'))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
  const failed = tasks.isError || catalog.isError
  const loading = tasks.isPending || catalog.isPending

  return <>
    <TopBar title={t('nav.myWork')} />
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{t('myWork.description')}</p>
          <div className="flex shrink-0 items-center gap-2">
            <Switch id="my-work-completed" checked={includeCompleted} onCheckedChange={setIncludeCompleted} />
            <Label htmlFor="my-work-completed">{t('myWork.includeCompleted')}</Label>
          </div>
        </div>
        {failed ? <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
          <p>{t('myWork.loadFailed')}</p>
          <Button variant="outline" size="sm" disabled={tasks.isFetching || catalog.isFetching} onClick={() => { void tasks.refetch(); void catalog.refetch() }}>{t('common.retry')}</Button>
        </div> : loading ? <div role="status" aria-label={t('common.loading')} aria-busy="true" className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div> : rows.length ?
          <ul aria-label={t('myWork.list')} className="space-y-2">
            {rows.map(task => {
              const assistant = assistants.get(task.assistantId)
              return <li key={task.id} className="min-w-0">
                <Link to={`/c/${task.id}`} aria-label={t('hub.openConversation', { code: task.code, title: task.title })} className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">{task.code}</span>
                    <TaskStatusBadge status={task.status} />
                    <StalledBadge task={task} />
                    <span className="min-w-0 basis-full truncate text-sm font-medium sm:basis-auto sm:flex-1" title={task.title}>{task.title}</span>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                      {assistant && <AssistantAvatar assistant={assistant} size="xs" />}
                      <span className="truncate">{assistant?.name ?? t('myWork.unknownAssistant')}</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1">
                      <span>{t('myWork.recentActivity')}</span>
                      <time dateTime={task.lastActivityAt} title={dates.formatDateTime(task.lastActivityAt)}>{dates.formatRelative(task.lastActivityAt)}</time>
                    </span>
                  </div>
                  {task.tags.length > 0 && <div className="flex min-w-0 flex-wrap gap-1">{task.tags.map(tag => <TagChip key={tag} tag={tag} size="xs" />)}</div>}
                </Link>
              </li>
            })}
          </ul> : <EmptyState icon={ListTodo} title={t('myWork.empty')} description={t('myWork.emptyDescription')} action={<Button asChild variant="outline" size="sm"><Link to="/">{t('myWork.goToHub')}</Link></Button>} />}
      </div>
    </div>
  </>
}
