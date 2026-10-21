import { use } from 'react'
import { MeContext } from '@/app/auth'
import { useUiStore } from '@/app/uiStore'
export function useAnswerDetail(scope?: 'sr') {
  const userId = use(MeContext)?.id ?? 'anonymous'
  const key = scope ? `${userId}:${scope}` : userId
  const detail = useUiStore(s => s.answerDetails[key] ?? (scope === 'sr' ? 'answer' : 'brief'))
  const set = useUiStore(s => s.setAnswerDetail)
  return { detail, toggle: () => set(key, detail === 'full' ? 'brief' : detail === 'brief' ? 'answer' : 'full') }
}
