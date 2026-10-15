import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useShortcut } from '@/lib/useShortcut'
import { useConversationUnread } from '@/lib/conversationRead'
import type { Task } from '@mes/domain'
import { ArrowLeftRight, Check } from 'lucide-react'
import { useNavigate } from 'react-router'
import { listTasks } from '@/api/tasks'
import { listSr } from '@/api/sr'
import { useMe } from '@/app/auth'
import { srDetailPath } from '@/app/useOpenSr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SrStatusBadge } from '@/components/StatusBadges'
import { AiRequestChip } from '@/features/home/AiRequestChip'
import { isAiResponding, selectMyActive } from '@/features/home/myActive'
import { useT } from '@/i18n'

const LIMIT = 10

/**
 * 대화 화면에서 내 진행 중 대화로 바로 옮긴다. 허브와 같은 ['tasks'] 쿼리·판정이고 SSE 무효화는 useEvents가 한다. 초안은 Composer가 taskId별로 보존한다.
 * 검색어를 넣으면 보이는 대화(번호·제목·연결 SR)와 SR(번호·제목 — 열람 범위는 SR 목록 API가 적용)을 찾는다(S14). SR 목록은 검색할 때만 부른다.
 */
export function QuickSwitch({ currentTaskId }: { currentTaskId: string }) {
  const t = useT()
  const me = useMe()
  const navigate = useNavigate()
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => listTasks() })
  const items = selectMyActive(tasks.data ?? [], me.id, LIMIT)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const srs = useQuery({ queryKey: ['sr', 'inbox'], queryFn: () => listSr('inbox'), enabled: open && !!needle })
  const matches = (...values: Array<string | undefined>) => values.some((value) => value?.toLocaleLowerCase().includes(needle))
  const foundTasks = needle ? (tasks.data ?? []).filter((task) => matches(task.code, task.title, ...(task.linkedSrCodes ?? []))).slice(0, LIMIT) : []
  const foundSrs = needle ? (srs.data ?? []).filter((sr) => sr.code && matches(sr.code, sr.title)).slice(0, LIMIT) : []
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useShortcut('k', () => { trigger.current?.focus(); setOpen(current => !current) })
  // 열리면 검색 입력에 바로 쓸 수 있게 — 메뉴가 콘텐츠에 초점을 둔 다음 프레임에 옮긴다
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => search.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])
  const responding = items.filter(isAiResponding).length
  const taskItem = (task: Task) => {
    const current = task.id === currentTaskId
    return <DropdownMenuItem key={task.id} disabled={current} aria-current={current ? 'page' : undefined} onSelect={() => void navigate(`/c/${encodeURIComponent(task.id)}`)} className="items-start text-xs">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-muted-foreground"><span className="font-mono">{task.code}</span>{task.aiRequest && <AiRequestChip aiRequest={task.aiRequest} className="ml-auto" />}</div>
        <div className="flex items-center gap-1.5"><span className="truncate font-medium">{task.title || task.code}</span><UnreadDot task={task} userId={me.id} /></div>
      </div>
      {current && <Check aria-hidden className="mt-0.5 size-3.5 shrink-0" />}
    </DropdownMenuItem>
  }
  return <DropdownMenu open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery('') }}>
    <DropdownMenuTrigger asChild>
      <Button ref={trigger} variant="ghost" size="icon" data-tour="quick-switch" title={t('task.header.quickSwitch')} className="relative text-muted-foreground after:absolute after:-inset-1.5"><ArrowLeftRight /><span className="sr-only">{t('task.header.quickSwitch')}</span>{responding > 0 && <><span aria-hidden className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-tone-violet-bg px-1 text-[11px] font-medium text-tone-violet-fg">{responding}</span><span className="sr-only"> {t('task.header.quickSwitchResponding', { count: responding })}</span></>}</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent ref={content} align="start" className="w-[min(22rem,calc(100vw-2rem))]">
      <div className="p-1">
        {/* 글자 키는 메뉴 typeahead로 새지 않게 막고, ↓는 첫 결과로, Esc·Tab은 메뉴가 처리한다 */}
        <Input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('task.header.quickSearch')} placeholder={t('task.header.quickSearchPlaceholder')} className="h-8 text-xs"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); content.current?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus() }
            else if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation()
          }} />
      </div>
      {needle ? <>
        {foundTasks.length > 0 && <><DropdownMenuLabel className="text-xs">{t('task.header.quickSearchConversations')}</DropdownMenuLabel>{foundTasks.map(taskItem)}</>}
        {foundSrs.length > 0 && <><DropdownMenuLabel className="text-xs">{t('task.header.quickSearchSrs')}</DropdownMenuLabel>{foundSrs.map((sr) => <DropdownMenuItem key={sr.id} onSelect={() => void navigate(srDetailPath(me.roles, sr.id))} className="items-start text-xs">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-muted-foreground"><span className="font-mono">{sr.code}</span><SrStatusBadge status={sr.status} className="ml-auto h-5 px-1.5 text-[11px]" /></div>
            <div className="truncate font-medium">{sr.title}</div>
          </div>
        </DropdownMenuItem>)}</>}
        {srs.isPending ? !foundTasks.length && <DropdownMenuItem disabled className="text-xs">{t('common.loading')}</DropdownMenuItem>
          : srs.isError ? <DropdownMenuItem className="text-xs" onSelect={(event) => { event.preventDefault(); void srs.refetch() }}>{t('sr.loadFailed')} {t('common.retry')}</DropdownMenuItem>
          : !foundTasks.length && !foundSrs.length && <DropdownMenuItem disabled className="text-xs">{t('task.header.quickSearchEmpty')}</DropdownMenuItem>}
      </> : <>
        <DropdownMenuLabel className="text-xs">{t('hub.myActiveConversations')}</DropdownMenuLabel>
        {tasks.isPending ? <DropdownMenuItem disabled className="text-xs">{t('common.loading')}</DropdownMenuItem>
          : tasks.isError ? <DropdownMenuItem className="text-xs" onSelect={() => void tasks.refetch()}>{t('hub.listFailed')} {t('common.retry')}</DropdownMenuItem>
          : items.length === 0 ? <DropdownMenuItem disabled className="text-xs">{t('hub.noMyActiveConversations')}</DropdownMenuItem>
          : items.map(taskItem)}
      </>}
    </DropdownMenuContent>
  </DropdownMenu>
}

function UnreadDot({ task, userId }: { task: Task; userId: string }) {
  const t = useT()
  const unread = useConversationUnread(task, userId)
  return unread ? <span role="img" aria-label={t('chat.unread')} title={t('chat.unread')} className="size-2 shrink-0 rounded-full bg-primary" /> : null
}
