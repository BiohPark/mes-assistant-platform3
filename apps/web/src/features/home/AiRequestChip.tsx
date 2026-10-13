import { AlertCircle, CircleSlash } from 'lucide-react'
import type { TaskAiRequest, TaskAiRequestStatus } from '@mes/domain'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

type AiKind = 'responding' | 'failed' | 'interrupted'
const KIND: Record<TaskAiRequestStatus, AiKind> = { pending: 'responding', streaming: 'responding', failed: 'failed', interrupted: 'interrupted' }
const VIEW: Record<AiKind, { tone: BadgeTone; label: 'hub.aiResponding' | 'hub.aiFailed' | 'hub.aiInterrupted' }> = {
  responding: { tone: 'violet', label: 'hub.aiResponding' },
  failed: { tone: 'danger', label: 'hub.aiFailed' },
  interrupted: { tone: 'warning', label: 'hub.aiInterrupted' },
}

/** 업무 상태 칩과 별개인 AI 요청 상태 칩. 응답 중은 점이 펄스(모션 감소 환경에서는 정지), 실패·중단은 아이콘. 텍스트 라벨을 항상 함께 둔다 */
export function AiRequestChip({ aiRequest, className }: { aiRequest: TaskAiRequest; className?: string }) {
  const t = useT()
  const kind = KIND[aiRequest.status]
  return <Badge tone={VIEW[kind].tone} data-ai-status={kind} title={aiRequest.phase} className={cn('gap-1', className)}>
    {kind === 'responding' ? <span aria-hidden data-pulse className="size-1.5 shrink-0 rounded-full bg-current motion-safe:animate-pulse" />
      : kind === 'failed' ? <AlertCircle aria-hidden className="size-3 shrink-0" /> : <CircleSlash aria-hidden className="size-3 shrink-0" />}
    {t(VIEW[kind].label)}
  </Badge>
}
