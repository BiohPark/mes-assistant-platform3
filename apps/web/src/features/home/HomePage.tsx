import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigationType } from 'react-router'
import { useMe } from '@/app/auth'
import { listTasks } from '@/api/tasks'
import { emptyHomeFilters, type HomeFilters } from '@/app/uiStore'
import { classificationOptions, homeFiltersFromParams, homeFiltersToParams, matchesAssistant, sameParams, validHomeFilters } from './filters'
import { Bot, KanbanSquare, LayoutGrid } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { TopBar } from '@/app/TopBar'
import { useUserMap } from '@/app/hooks'
import { useUiStore } from '@/app/uiStore'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { AssistantCard } from './AssistantCard'
import { CardMapFilterBar } from './CardMapFilterBar'
import { ConversationKanban } from './ConversationKanban'
import { useAssistantRows } from './useAssistantStats'
import { useQuery } from '@tanstack/react-query'
import { getSettings } from '@/api/admin'
import { useT } from '@/i18n'
import { useTablistKeys } from '@/lib/useTablistKeys'

const views = ['cards', 'kanban'] as const

export function HomePage() {
  const t = useT()
  const me = useMe()
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => listTasks() })
  const myActive = (tasks.data ?? []).filter(task => task.status === 'in_progress' && (task.ownerId === me.id || task.assigneeIds.includes(me.id))).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, 6)
  const link1Rule = useQuery({ queryKey: ['settings'], queryFn: getSettings }).data?.link1Rule
  const [params, setParams] = useSearchParams()
  const { key: navigationKey } = useLocation()
  const navigationType = useNavigationType()
  const view = params.get('view') === 'kanban' ? 'kanban' : 'cards'
  const { rows, isPending, isError, isFetching, refetch } = useAssistantRows()
  const users = useUserMap()
  // Entry links without card keys restore saved choices while preserving kanban filters. Later navigation follows the URL.
  const [initial] = useState(() => !['aq', 'l1', 'l2', 'retired'].some(key => params.has(key)) ? homeFiltersToParams(useUiStore.getState().homeFilters, params) : new URLSearchParams(params))
  const started = useRef(false)
  const activeParams = started.current ? params : initial
  const rawFilters = homeFiltersFromParams(activeParams)
  const all = rows ?? []
  const filters = rows ? validHomeFilters(rawFilters, all.map(row => row.assistant)) : rawFilters
  // The updater can still receive the URL preceding an in-flight search replace.
  const pendingSearch = useRef<string | undefined>(undefined)
  // Keep the kanban draft alive when a view switch supersedes its search replace.
  const pendingKanbanSearch = useRef<string | undefined>(undefined)
  const kanbanQuery = params.get('q') ?? ''
  useEffect(() => {
    if (navigationType === 'POP' || pendingSearch.current === rawFilters.q) pendingSearch.current = undefined
    if (navigationType === 'POP' || pendingKanbanSearch.current === kanbanQuery) pendingKanbanSearch.current = undefined
  }, [rawFilters.q, kanbanQuery, navigationKey, navigationType])
  const withPendingKanbanSearch = (prev: URLSearchParams) => {
    const next = new URLSearchParams(prev)
    if (pendingKanbanSearch.current !== undefined) {
      next.delete('q')
      if (pendingKanbanSearch.current) next.set('q', pendingKanbanSearch.current)
    }
    return next
  }
  const latestFilters = (prev: URLSearchParams) => {
    const latest = homeFiltersFromParams(prev)
    const next = { ...latest, q: pendingSearch.current ?? latest.q }
    return rows ? validHomeFilters(next, all.map(row => row.assistant)) : next
  }
  const options = classificationOptions(all.map(row => row.assistant), filters.level1CodeIds)
  // Keep selected Lv2 chips visible even when they belong to another Lv1, so conflicting selections can be cleared explicitly.
  const allLevel2 = classificationOptions(all.map(row => row.assistant), []).level2
  options.level2 = [...options.level2, ...allLevel2.filter(option => filters.level2CodeIds.includes(option.id) && !options.level2.some(current => current.id === option.id))]
  const filtered = all.filter(row => matchesAssistant(row.assistant, filters))
  const canonical = homeFiltersToParams(filters, activeParams).toString()
  // Rewrite only when the content differs. The updater receives the render-time URL, and the router commits
  // navigations in a transition, so a rewrite issued from an older render would overwrite a newer navigation.
  const normalized = sameParams(new URLSearchParams(canonical), params)
  useEffect(() => {
    const restore = !started.current
    started.current = true
    if (!normalized) setParams(prev => {
      const base = withPendingKanbanSearch(restore ? homeFiltersToParams(homeFiltersFromParams(initial), prev) : prev)
      const latest = homeFiltersFromParams(base)
      const next = { ...latest, q: pendingSearch.current ?? latest.q }
      return homeFiltersToParams(rows ? validHomeFilters(next, rows.map(row => row.assistant)) : next, base)
    }, { replace: true })
    useUiStore.getState().setHomeFilters(homeFiltersFromParams(new URLSearchParams(canonical)))
  }, [canonical, normalized, initial, rows, setParams])
  const update = (patch: Partial<HomeFilters>) => {
    if (patch.q !== undefined) pendingSearch.current = patch.q
    setParams(prev => homeFiltersToParams({ ...latestFilters(prev), ...patch }, withPendingKanbanSearch(prev)), { replace: patch.q !== undefined })
  }
  const reset = () => {
    pendingSearch.current = ''
    useUiStore.getState().setHomeFilters(emptyHomeFilters())
    setParams(prev => homeFiltersToParams(emptyHomeFilters(), withPendingKanbanSearch(prev)))
  }
  const switchView = (nextView: 'cards' | 'kanban') => setParams(prev => {
    const next = homeFiltersToParams(latestFilters(prev), withPendingKanbanSearch(prev))
    if (nextView === 'kanban') next.set('view', 'kanban')
    else next.delete('view')
    return next
  })
  const filterCount = filters.level1CodeIds.length + filters.level2CodeIds.length + Number(filters.showRetired)
  const viewKeys = useTablistKeys(views, view, switchView)

  return <>
    <TopBar title={t('nav.hub')} actions={me.roles.includes('system_owner') && <Button size="sm" variant="outline" asChild><Link to="/assistants/manage">{t('hub.manageAgents')}</Link></Button>} />
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 lg:p-6">
      <div role="tablist" aria-label={t('hub.viewSwitch')} className="inline-flex self-start rounded-xl border bg-muted p-1 shadow-xs" {...viewKeys.tablistProps}>
        <button type="button" {...viewKeys.tabProps('cards')} onClick={() => switchView('cards')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${view === 'cards' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}><LayoutGrid className="size-4" />{t('hub.assistantCards')}</button>
        <button type="button" {...viewKeys.tabProps('kanban')} onClick={() => switchView('kanban')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${view === 'kanban' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}><KanbanSquare className="size-4" />{t('hub.conversationKanban')}</button>
      </div>
      {view === 'kanban' ? <ConversationKanban pendingSearch={pendingKanbanSearch} /> : <>
      <section aria-label={t('hub.myActiveConversations')} className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{t('hub.myActiveConversations')}</span>
        {tasks.isPending ? <span className="text-muted-foreground">{t('common.loading')}</span> : tasks.isError ? <Button size="xs" variant="ghost" onClick={() => void tasks.refetch()}>{t('common.retry')}</Button> : myActive.length ? myActive.map(task => <Link key={task.id} to={`/c/${encodeURIComponent(task.id)}`} className="max-w-48 truncate rounded-full border px-2 py-1 hover:bg-muted" title={`${task.code} ${task.title}`}>{task.title || task.code}</Link>) : <span className="text-muted-foreground">{t('hub.noMyActiveConversations')}</span>}
      </section>
      <CardMapFilterBar level1Options={options.level1} level2Options={options.level2} filters={filters} onChange={update} onReset={reset} />
      {isPending && <div className="text-sm text-muted-foreground">{t('common.loading')}</div>}
      {isError && <div role="alert" className="text-sm">
        <h2 className="mb-2 text-lg font-semibold">{t('common.serverUnavailable')}</h2>
        <p className="mb-3 text-muted-foreground">{t('common.serverUnavailableHelp')}</p>
        <Button size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()}>{t('common.retry')}</Button>
      </div>}
      {rows && filtered.length === 0 && <EmptyState
        icon={Bot}
        title={all.length === 0 ? t('hub.noAssistants') : t('hub.noMatchingAssistants')}
        description={all.length === 0 ? t('hub.noAssistantsHelp') : t('hub.noMatchingHelp')}
        action={all.length > 0 && <div className="flex gap-2">
          {filters.q && <Button size="sm" variant="outline" onClick={() => update({ q: '' })}>{t('hub.clearSearch')}</Button>}
          {filterCount > 0 && <Button size="sm" variant="outline" onClick={() => update({ level1CodeIds: [], level2CodeIds: [], showRetired: false })}>{t('hub.clearFilters', { count: filterCount })}</Button>}
        </div>}
      />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((row) => <AssistantCard key={row.assistant.id} row={row} owner={users.get(row.assistant.ownerId)} baseUrl="" link1Rule={link1Rule} />)}
      </div>
      </>}
    </div>
  </>
}
