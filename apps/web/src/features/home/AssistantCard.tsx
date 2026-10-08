import { Link } from 'react-router'
import { BookOpen, ExternalLink, MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { useMe } from '@/app/auth'
import { AssistantStatusBadge, IoBadges } from '@/components/StatusBadges'
import { UserAvatar } from '@/components/UserAvatar'
import { assistantLink1 } from '@/lib/links'
import { cn } from '@/lib/utils'
import type { CatalogUser } from '@mes/contracts'
import type { AssistantRow } from './useAssistantStats'
import { useT } from '@/i18n'

interface AssistantCardProps {
  row: AssistantRow
  owner?: CatalogUser
  baseUrl: string
  link1Rule?: string
}

/** 카드 본문(표시 전용). 일반 카드와 편집 모드 카드가 같이 쓴다. */
export function AssistantCardBody({ row, owner, dimmed }: { row: AssistantRow; owner?: CatalogUser; dimmed?: boolean }) {
  const t = useT()
  const a = row.assistant
  return (
    <>
      <div className={cn('pointer-events-none flex items-start justify-between', dimmed && 'opacity-60')}>
        <AssistantAvatar assistant={a} size="md" />
        <AssistantStatusBadge status={a.status} />
      </div>
      <div className={cn('pointer-events-none min-w-0', dimmed && 'opacity-60')}>
        <div className="text-xs text-muted-foreground">
          {a.level1} › {a.level2}{(a.classifications?.length ?? 1) > 1 && ` +${a.classifications!.length - 1}`}
        </div>
        <div className="truncate font-semibold" title={a.name}>
          {a.name}
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.summary}</p>
      </div>
      <div className="relative z-10 min-w-0"><IoBadges inputs={a.expectedInputs} outputs={a.expectedOutputs} compact /></div>
      <div className="pointer-events-none mt-auto flex items-center justify-between text-xs group-hover:invisible group-focus-within:invisible [@media(hover:none)]:invisible">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <span className="font-medium text-foreground">{row.activeCount}</span> {t('hub.active')}
          {row.overdueCount > 0 && <span className="text-red-600">{t('hub.overdue', { count: row.overdueCount })}</span>}
          {!a.modelId && <span className="ml-1 rounded-full border px-1 text-[11px]">{t('hub.defaultModel')}</span>}
        </span>
        {owner && <UserAvatar user={owner} size="xs" />}
      </div>
    </>
  )
}

export const CARD_CLASS = 'group relative flex min-h-56 flex-col gap-3 rounded-2xl border bg-card p-4 shadow-xs transition'

/**
 * 카드 클릭 = 바로 대화할 준비(초안). 첫 전송 때 대화가 만들어진다.
 * stretched-link 패턴: 본문 위에 투명 Link, hover 액션은 그 위(z-10). <a> 중첩을 피한다.
 */
export function AssistantCard({ row, owner, baseUrl, link1Rule }: AssistantCardProps) {
  const t = useT()
  const isOwner = useMe().roles.includes('system_owner')
  const a = row.assistant
  const link1 = assistantLink1(baseUrl, a, link1Rule)
  const retired = a.status === 'retired'
  return (
    <div className={cn(CARD_CLASS, 'hover:-translate-y-0.5 hover:shadow-md')} style={{ borderTopColor: a.color, borderTopWidth: 3 }}>
      {retired ? (
        <span className="absolute inset-0 rounded-2xl" aria-label={t('hub.retiredAssistantLabel', { name: a.name })} />
      ) : (
        <Link to={`/new/${encodeURIComponent(a.id)}`} className="absolute inset-0 rounded-2xl" aria-label={t('hub.newConversationWith', { name: a.name })} />
      )}
      <AssistantCardBody row={row} owner={owner} dimmed={retired} />
      <div className="absolute inset-x-3 bottom-3 z-10 hidden flex-wrap gap-1 group-hover:flex group-focus-within:flex [@media(hover:none)]:flex">
        {!retired && (
          <Button size="xs" variant="secondary" asChild>
            <Link to={`/new/${encodeURIComponent(a.id)}`}>
              <MessageSquarePlus data-icon="inline-start" />
              {t('hub.conversation')}
            </Link>
          </Button>
        )}
        {link1 && <Button size="xs" variant="ghost" asChild>
          <a href={link1} target="_blank" rel="noreferrer" title={t('hub.openWebUi')}>
            <ExternalLink data-icon="inline-start" />
            OpenWebUI
          </a>
        </Button>}
        {a.docUrl && (
          <Button size="xs" variant="ghost" asChild>
            <a href={a.docUrl} target="_blank" rel="noreferrer" title={t('hub.descriptionPage')}>
              <BookOpen data-icon="inline-start" />
              {t('hub.description')}
            </a>
          </Button>
        )}
        {isOwner && <Button size="xs" variant="outline" asChild><Link to={`/assistants/manage?edit=${encodeURIComponent(a.id)}`} aria-label={t('hub.editAgentLabel', { name: a.name })}>{t('hub.editAgent')}</Link></Button>}
      </div>
    </div>
  )
}
