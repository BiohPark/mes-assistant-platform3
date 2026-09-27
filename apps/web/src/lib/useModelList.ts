import { useQuery } from '@tanstack/react-query'
import { LlmModelsSchema } from '@mes/contracts'

/** 모델 목록은 서버 설정을 기준으로 조회한다. 브라우저에는 API 키가 없다. */
export function useModelList() {
  const query = useQuery({
    queryKey: ['llm', 'models'],
    queryFn: async () => {
      const response = await fetch('/api/llm/models', { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`모델 목록 조회 실패 (HTTP ${response.status})`)
      return LlmModelsSchema.parse(await response.json()).models
    },
  })
  return { models: query.data ?? [], loading: query.isPending, reload: async () => { await query.refetch() } }
}
