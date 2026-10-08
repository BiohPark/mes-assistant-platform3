import { useQueries } from '@tanstack/react-query'
import type { FileMeta } from '@/api/files'
import { FileList } from '@/features/task/FileList'
import { useMe } from '@/app/auth'

export function SrAttachments({ ids }: { ids: string[] }) {
  const me = useMe()
  // 요청자(BO)는 버전 기록 API(/files/:id/versions)가 403이므로 버튼을 보이지 않는다.
  const requesterOnly = me.roles.includes('requester') && !me.roles.includes('system_owner')
  const queries = useQueries({ queries: ids.map(id => ({ queryKey: ['file', id], queryFn: async () => {
    const response = await fetch(`/api/files/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json() as Promise<FileMeta>
  } })) })
  return <FileList files={queries.flatMap(query => query.data ? [query.data] : [])} canDelete={false} canViewHistory={!requesterOnly} />
}
