import { LayoutGrid } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { TopBar } from '@/app/TopBar'

/** 허브 — S0은 빈 상태. 에이전트 카드·칸반은 S2에서 API와 함께 옮긴다 */
export function HomePage() {
  return (
    <>
      <TopBar title="에이전트 허브" />
      <div className="flex-1 overflow-auto p-4 lg:p-6">
        <EmptyState
          icon={LayoutGrid}
          title="등록된 에이전트가 없습니다"
          description="System Owner가 에이전트를 등록하면 여기에 카드로 보입니다."
        />
      </div>
    </>
  )
}
