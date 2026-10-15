import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Sparkles } from 'lucide-react'
import { getChatBrief } from '@/api/tasks'
import { useDates } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

const COLLAPSED_KEY = 'mes-chat-brief-collapsed'
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false } }

/**
 * 대화 요약 카드(표시 전용) — 1줄(무슨 대화)·3줄(다음 제안)은 AI가, 2줄(질문 수·참여자·시작)은 서버가 센다.
 * 생성 중·실패·불러오기 실패여도 대화 화면은 그대로다. 접힘 상태는 이 브라우저에 기억한다(모든 대화 공통).
 */
export function ChatBrief({ taskId }: { taskId: string }) {
  const t = useT()
  const { formatRelative } = useDates()
  const bodyId = useId()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const brief = useQuery({ queryKey: ['chat-brief', taskId], queryFn: ({ signal }) => getChatBrief(taskId, signal), retry: false })
  const data = brief.data
  if (!data || (!data.ai && !data.stats.questions && !data.stats.participants.length)) return null
  function toggle() {
    setCollapsed((current) => {
      try { localStorage.setItem(COLLAPSED_KEY, current ? '0' : '1') } catch { /* 저장이 막혀도 이번 화면에는 적용한다 */ }
      return !current
    })
  }
  const { stats, ai } = data
  const progress = [t('chat.brief.questions', { count: stats.questions }),
    ...(stats.participants.length ? [t('chat.brief.participants', { names: stats.participants.map((user) => user.name).join(', ') })] : []),
    t('chat.brief.started', { when: formatRelative(stats.startedAt) })].join(' · ')
  const placeholder = data.generating ? t('chat.brief.generating') : data.failed ? t('chat.brief.failed') : t('chat.brief.pending')
  return <section data-testid="chat-brief" className="mx-4 mt-2 shrink-0 rounded-md border bg-muted/30 text-sm">
    <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-controls={bodyId} title={t('chat.brief.toggle')}
      className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-muted-foreground">
      <Sparkles className="size-3.5 shrink-0" aria-hidden />
      <span className="flex-1">{t('chat.brief.title')}{ai?.source === 'rule' && t('chat.brief.ruleBased')}</span>
      {ai && data.generating && data.stale && <span role="status">{t('chat.brief.refreshing')}</span>}
      <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', collapsed && '-rotate-90')} aria-hidden />
    </button>
    {!collapsed && <div id={bodyId} className="space-y-0.5 px-3 pb-2">
      {ai ? <p className="font-medium">{ai.about}</p> : <p role="status" className="text-muted-foreground">{placeholder}</p>}
      <p className="text-xs text-muted-foreground">{progress}</p>
      {ai && <p><span className="mr-1 text-xs font-medium text-muted-foreground">{t('chat.brief.next')}</span><span>{ai.next}</span></p>}
    </div>}
  </section>
}
