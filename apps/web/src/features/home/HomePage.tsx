import { Bot } from 'lucide-react'
import { TopBar } from '@/app/TopBar'
import { useUserMap } from '@/app/hooks'
import { useUiStore } from '@/app/uiStore'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { AssistantCard } from './AssistantCard'
import { CardMapFilterBar } from './CardMapFilterBar'
import { useAssistantRows, type AssistantRow } from './useAssistantStats'

function matches(row: AssistantRow, q: string, level1CodeId: string | null, level2CodeId: string | null, showRetired: boolean): boolean {
  const assistant = row.assistant
  if (!showRetired && assistant.status === 'retired') return false
  if (level1CodeId && assistant.level1CodeId !== level1CodeId) return false
  if (level2CodeId && assistant.level2CodeId !== level2CodeId) return false
  if (!q) return true
  return `${assistant.name} ${assistant.summary} ${assistant.level1} ${assistant.level2}`.toLowerCase().includes(q.toLowerCase())
}

export function HomePage() {
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
    <TopBar title="에이전트 허브" />
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 lg:p-6">
      <CardMapFilterBar level1Options={level1Options} level2Options={level2Options} level1CodeId={level1CodeId} level2CodeId={level2CodeId} />
      {isPending && <div className="text-sm text-muted-foreground">불러오는 중…</div>}
      {isError && <div role="alert" className="text-sm">
        <h2 className="mb-2 text-lg font-semibold">서버에 연결할 수 없습니다</h2>
        <p className="mb-3 text-muted-foreground">잠시 뒤 다시 시도하세요. 계속되면 관리자에게 알려 주세요.</p>
        <Button size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()}>다시 시도</Button>
      </div>}
      {rows && filtered.length === 0 && <EmptyState
        icon={Bot}
        title={all.length === 0 ? '등록된 에이전트가 없습니다' : '조건에 맞는 에이전트가 없습니다'}
        description={all.length === 0 ? 'System Owner가 에이전트를 등록하면 여기에 카드로 보입니다.' : '검색어나 필터를 바꿔 보세요.'}
      />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {filtered.map((row) => <AssistantCard key={row.assistant.id} row={row} owner={users.get(row.assistant.ownerId)} baseUrl="" />)}
      </div>
    </div>
  </>
}
