import { useQueries } from '@tanstack/react-query'
import type { FileMeta } from '@/api/files'
import { FileList } from '@/features/task/FileList'
import { useMe } from '@/app/auth'

/** SR 첨부 메타데이터(요청자 범위의 /files/:id). 아직 안 온 파일은 제외한다. */
export function useSrFiles(ids: string[]) {
  const queries = useQueries({ queries: ids.map(id => ({ queryKey: ['file', id], queryFn: async () => {
    const response = await fetch(`/api/files/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json() as Promise<FileMeta>
  } })) })
  return queries.flatMap(query => query.data ? [query.data] : [])
}

export function SrAttachments({ ids }: { ids: string[] }) {
  const me = useMe()
  // 요청자(BO)는 버전 기록 API(/files/:id/versions)가 403이므로 버튼을 보이지 않는다.
  const requesterOnly = me.roles.includes('requester') && !me.roles.includes('system_owner')
  return <FileList files={useSrFiles(ids)} canDelete={false} canViewHistory={!requesterOnly} />
}
