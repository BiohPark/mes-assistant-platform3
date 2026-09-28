import { Bot } from 'lucide-react'
import { TopBar } from '@/app/TopBar'
import { useUserMap } from '@/app/hooks'
import { useUiStore } from '@/app/uiStore'
import { EmptyState } from '@/components/EmptyState'
import { AssistantCard } from './AssistantCard'
import { CardMapFilterBar } from './CardMapFilterBar'
import { useAssistantRows, type AssistantRow } from './useAssistantStats'

function matches(row: AssistantRow, q: string, level1: string | null, level2: string | null, showRetired: boolean): boolean {
  const assistant = row.assistant
  if (!showRetired && assistant.status === 'retired') return false
  if (level1 && assistant.level1 !== level1) return false
  if (level2 && assistant.level2 !== level2) return false
  if (!q) return true
  return `${assistant.name} ${assistant.summary} ${assistant.level1} ${assistant.level2}`.toLowerCase().includes(q.toLowerCase())
}

export function HomePage() {
  const rows = useAssistantRows()
  const users = useUserMap()
  const { q, level1, level2, showRetired } = useUiStore((state) => state.homeFilters)
  const all = rows ?? []
  const filtered = all.filter((row) => matches(row, q, level1, level2, showRetired))
  const level1Options = [...new Set(all.map((row) => row.assistant.level1))]
  const level2Options = level1 ? [...new Set(all.filter((row) => row.assistant.level1 === level1).map((row) => row.assistant.level2))] : []

  return <>
    <TopBar title="에이전트 허브" />
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 lg:p-6">
      <CardMapFilterBar level1Options={level1Options} level2Options={level2Options} />
      {filtered.length === 0 && <EmptyState
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
