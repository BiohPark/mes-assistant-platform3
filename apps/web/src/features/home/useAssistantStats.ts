import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Assistant } from '@mes/contracts'
import { listAssistantStats, listAssistants } from '@/lib/catalog'

export interface AssistantRow {
  assistant: Assistant
  activeCount: number
  overdueCount: number
  doneCount: number
}

/** 카드맵 한 줄: 데모의 집계 형태에 API 결과를 맞춘다. */
export function useAssistantRows() {
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const stats = useQuery({ queryKey: ['assistant-stats'], queryFn: listAssistantStats })
  // Stable identity: HomePage effects depend on rows, so a new array per render would re-run them on every unrelated update.
  const rows = useMemo(() => {
    if (!assistants.data) return undefined
    const counts = new Map((stats.data ?? []).map((item) => [item.assistantId, item]))
    return assistants.data.map((assistant) => {
      const count = counts.get(assistant.id)
      return { assistant, activeCount: (count?.open ?? 0) + (count?.inProgress ?? 0) + (count?.onHold ?? 0), overdueCount: 0, doneCount: count?.done ?? 0 }
    }).sort((a, b) => a.assistant.order - b.assistant.order)
  }, [assistants.data, stats.data])
  if (!rows) return { rows: undefined, isPending: assistants.isPending, isError: assistants.isError, isFetching: assistants.isFetching, refetch: assistants.refetch }
  return { rows, isPending: false, isError: false, isFetching: assistants.isFetching, refetch: assistants.refetch }
}
