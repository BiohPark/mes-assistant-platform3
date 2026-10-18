import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { filesForTask, getCandidates, getCandidateCount } from '@/api/files'
import { listSrInputs } from '@/api/srInputs'
import { subscribeEvent } from '@/app/useEvents'

/** Shared query keys keep the composer picker and the optional side panel in sync. */
export function useMaterialCandidates(taskId: string, details = true) {
  const query = useQueryClient()
  const count = useQuery({ queryKey: ['candidate-count', taskId], queryFn: () => getCandidateCount(taskId), enabled: !details })
  const candidates = useQuery({ queryKey: ['candidates', taskId], queryFn: () => getCandidates(taskId), enabled: details })
  const own = useQuery({ queryKey: ['files', taskId], queryFn: () => filesForTask(taskId), enabled: details })
  const srBodies = useQuery({ queryKey: ['sr-inputs', taskId], queryFn: () => listSrInputs(taskId), retry: false, enabled: details })
  useEffect(() => subscribeEvent(({ event, data }) => {
    if (event === 'sr.updated' || event === 'file.updated' || event === 'task.updated' || ((event === 'input.updated' || event === 'context.updated') && data.taskId === taskId)) {
      void query.invalidateQueries({ queryKey: ['candidate-count', taskId] })
      void query.invalidateQueries({ queryKey: ['sr-inputs', taskId] })
      void query.invalidateQueries({ queryKey: ['candidates', taskId] })
      void query.invalidateQueries({ queryKey: ['conversation-inputs', taskId] })
      void query.invalidateQueries({ queryKey: ['previous-materials', taskId] })
    }
  }), [query, taskId])
  return { candidates, own, srBodies, count: count.data?.count ?? 0 }
}
