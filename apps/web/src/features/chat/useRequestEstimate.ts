import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { estimateRequest, type RequestEstimate } from '@/api/requests'

export function useRequestEstimate(threadId: string | undefined, draft: string, revision: string, enabled: boolean): RequestEstimate | undefined {
  const key = JSON.stringify({ threadId, draft, revision })
  const [ready, setReady] = useState<string>()
  useEffect(() => {
    if (!enabled || !threadId) return
    const timer = setTimeout(() => setReady(key), 400)
    return () => clearTimeout(timer)
  }, [enabled, threadId, key])
  const query = useQuery({ queryKey: ['estimate', threadId, ready], queryFn: () => estimateRequest(threadId!, { draft: JSON.parse(ready!)?.draft as string }),
    enabled: enabled && !!threadId && !!ready && ready === key, retry: false })
  return ready === key && enabled ? query.data : undefined
}
