import { useQueries } from '@tanstack/react-query'
import type { FileMeta } from '@/api/files'
import { FileList } from '@/features/task/FileList'

export function SrAttachments({ ids }: { ids: string[] }) {
  const queries = useQueries({ queries: ids.map(id => ({ queryKey: ['file', id], queryFn: async () => {
    const response = await fetch(`/api/files/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json() as Promise<FileMeta>
  } })) })
  return <FileList files={queries.flatMap(query => query.data ? [query.data] : [])} canDelete={false} />
}
