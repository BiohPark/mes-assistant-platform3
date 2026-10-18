import { use } from 'react'
import { MeContext } from '@/app/auth'
import { useUiStore } from '@/app/uiStore'
export function useAnswerDetail() {
  const userId = use(MeContext)?.id ?? 'anonymous'
  const detail = useUiStore(s => s.answerDetails[userId] ?? 'brief')
  const set = useUiStore(s => s.setAnswerDetail)
  return { detail, toggle: () => set(userId, detail === 'full' ? 'brief' : 'full') }
}
