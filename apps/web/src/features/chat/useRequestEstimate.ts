import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { estimateRequest, type RequestEstimate } from '@/api/requests'

export interface RequestEstimateState {
  /** 마지막으로 성공한 추정. 새 추정이 끝날 때까지 이전 값을 유지한다 */
  data?: RequestEstimate
  /** 현재 초안·입력에 대한 추정이 아직 없음 (디바운스 대기 또는 호출 중) */
  pending: boolean
  /** pending 중이고 변경이 초안이 아니라 입력·모델·메시지(revision)에서 왔음 */
  revisionChanged: boolean
}

export function useRequestEstimate(threadId: string | undefined, draft: string, revision: string, enabled: boolean): RequestEstimateState {
  const key = JSON.stringify({ threadId, draft, revision })
  const [ready, setReady] = useState<string>()
  const active = enabled && !!threadId
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setReady(key), 400)
    return () => clearTimeout(timer)
  }, [active, key])
  const query = useQuery({ queryKey: ['estimate', threadId, ready], queryFn: () => estimateRequest(threadId!, { draft: JSON.parse(ready!)?.draft as string }),
    enabled: active && !!ready && ready === key, retry: false })
  const settled = ready === key && (query.isSuccess || query.isError)
  const current = active && settled ? query.data : undefined
  const last = useRef<{ threadId: string; revision: string; data: RequestEstimate }>(undefined)
  useEffect(() => {
    if (current && threadId) last.current = { threadId, revision, data: current }
  }, [current, threadId, revision])
  if (!active) return { data: undefined, pending: false, revisionChanged: false }
  const previous = last.current?.threadId === threadId ? last.current : undefined
  const pending = !settled
  return { data: current ?? previous?.data, pending, revisionChanged: pending && !!previous && previous.revision !== revision }
}
