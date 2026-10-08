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
import { useAssistantRows, type AssistantRow } from './useAssistantStats'
import { useQuery } from '@tanstack/react-query'
import { getSettings } from '@/api/admin'
import { useT } from '@/i18n'

function matches(row: AssistantRow, q: string, level1CodeId: string | null, level2CodeId: string | null, showRetired: boolean): boolean {
  const assistant = row.assistant
  if (!showRetired && assistant.status === 'retired') return false
  if (level1CodeId && assistant.level1CodeId !== level1CodeId) return false
  if (level2CodeId && assistant.level2CodeId !== level2CodeId) return false
  if (!q) return true
  return `${assistant.name} ${assistant.summary} ${assistant.level1} ${assistant.level2}`.toLowerCase().includes(q.toLowerCase())
}

export function HomePage() {
  const t = useT()
  const link1Rule = useQuery({ queryKey: ['settings'], queryFn: getSettings }).data?.link1Rule
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'kanban' ? 'kanban' : 'cards'
  const { rows, isPending, isError, isFetching, refetch } = useAssistantRows()
  const users = useUserMap()
  const { q, level1CodeId: savedLevel1CodeId, level2CodeId: savedLevel2CodeId, showRetired } = useUiStore((state) => state.homeFilters)
  const all = rows ?? []
  const level1Options = [...new Map(all.map((row) => [row.assistant.level1CodeId, { id: row.assistant.level1CodeId, label: row.assistant.level1 }])).values()]
  const level1CodeId = level1Options.some((option) => option.id === savedLevel1CodeId) ? savedLevel1CodeId : null
  const level2Options = level1CodeId ? [...new Map(all.filter((row) => row.assistant.level1CodeId === level1CodeId).map((row) => [row.assistant.level2CodeId, { id: row.assistant.level2CodeId, label: row.assistant.level2 }])).values()] : []
  const level2CodeId = level2Options.some((option) => option.id === savedLevel2CodeId) ? savedLevel2CodeId : null
  const filtered = all.filter((row) => matches(row, q, level1CodeId, level2CodeId, showRetired))

  return <>
    <TopBar title={t('nav.hub')} />
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 lg:p-6">
      <div role="tablist" aria-label={t('hub.viewSwitch')} className="inline-flex self-start rounded-xl border bg-muted p-1 shadow-xs">
        <button type="button" role="tab" aria-selected={view === 'cards'} onClick={() => setParams(new URLSearchParams())} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${view === 'cards' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}><LayoutGrid className="size-4" />{t('hub.assistantCards')}</button>
        <button type="button" role="tab" aria-selected={view === 'kanban'} onClick={() => { const next = new URLSearchParams(params); next.set('view', 'kanban'); setParams(next) }} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${view === 'kanban' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}><KanbanSquare className="size-4" />{t('hub.conversationKanban')}</button>
      </div>
      {view === 'kanban' ? <ConversationKanban /> : <>
      <CardMapFilterBar level1Options={level1Options} level2Options={level2Options} level1CodeId={level1CodeId} level2CodeId={level2CodeId} />
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
      />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {filtered.map((row) => <AssistantCard key={row.assistant.id} row={row} owner={users.get(row.assistant.ownerId)} baseUrl="" link1Rule={link1Rule} />)}
      </div>
      </>}
    </div>
  </>
}
