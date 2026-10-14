import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useShortcut } from '@/lib/useShortcut'
import { useConversationUnread } from '@/lib/conversationRead'
import type { Task } from '@mes/domain'
import { ArrowLeftRight, Check } from 'lucide-react'
import { useNavigate } from 'react-router'
import { listTasks } from '@/api/tasks'
import { useMe } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AiRequestChip } from '@/features/home/AiRequestChip'
import { isAiResponding, selectMyActive } from '@/features/home/myActive'
import { useT } from '@/i18n'

const LIMIT = 10

/** 대화 화면에서 내 진행 중 대화로 바로 옮긴다. 허브와 같은 ['tasks'] 쿼리·판정이고 SSE 무효화는 useEvents가 한다. 초안은 Composer가 taskId별로 보존한다 */
export function QuickSwitch({ currentTaskId }: { currentTaskId: string }) {
  const t = useT()
  const me = useMe()
  const navigate = useNavigate()
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => listTasks() })
  const items = selectMyActive(tasks.data ?? [], me.id, LIMIT)
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  useShortcut('k', () => { trigger.current?.focus(); setOpen(current => !current) })
  const responding = items.filter(isAiResponding).length
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild>
      <Button ref={trigger} variant="ghost" size="icon" title={t('task.header.quickSwitch')} className="relative text-muted-foreground after:absolute after:-inset-1.5"><ArrowLeftRight /><span className="sr-only">{t('task.header.quickSwitch')}</span>{responding > 0 && <><span aria-hidden className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-tone-violet-bg px-1 text-[11px] font-medium text-tone-violet-fg">{responding}</span><span className="sr-only"> {t('task.header.quickSwitchResponding', { count: responding })}</span></>}</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-[min(22rem,calc(100vw-2rem))]">
      <DropdownMenuLabel className="text-xs">{t('hub.myActiveConversations')}</DropdownMenuLabel>
      {tasks.isPending ? <DropdownMenuItem disabled className="text-xs">{t('common.loading')}</DropdownMenuItem>
        : tasks.isError ? <DropdownMenuItem className="text-xs" onSelect={() => void tasks.refetch()}>{t('hub.listFailed')} {t('common.retry')}</DropdownMenuItem>
        : items.length === 0 ? <DropdownMenuItem disabled className="text-xs">{t('hub.noMyActiveConversations')}</DropdownMenuItem>
        : items.map((task) => {
          const current = task.id === currentTaskId
          return <DropdownMenuItem key={task.id} disabled={current} aria-current={current ? 'page' : undefined} onSelect={() => void navigate(`/c/${encodeURIComponent(task.id)}`)} className="items-start text-xs">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-muted-foreground"><span className="font-mono">{task.code}</span>{task.aiRequest && <AiRequestChip aiRequest={task.aiRequest} className="ml-auto" />}</div>
              <div className="flex items-center gap-1.5"><span className="truncate font-medium">{task.title || task.code}</span><UnreadDot task={task} userId={me.id} /></div>
            </div>
            {current && <Check aria-hidden className="mt-0.5 size-3.5 shrink-0" />}
          </DropdownMenuItem>
        })}
    </DropdownMenuContent>
  </DropdownMenu>
}

function UnreadDot({ task, userId }: { task: Task; userId: string }) {
  const t = useT()
  const unread = useConversationUnread(task, userId)
  return unread ? <span role="img" aria-label={t('chat.unread')} title={t('chat.unread')} className="size-2 shrink-0 rounded-full bg-primary" /> : null
}
