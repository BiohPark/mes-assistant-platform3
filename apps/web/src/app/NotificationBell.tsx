import { useT } from '@/i18n'
import { useNumberFormat } from '@/lib/numbers'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Bell, CheckCheck } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { listNotifications, markAllRead, markRead, unreadCount } from '@/api/notifications'
import { useDates } from '@/lib/dates'

export function NotificationBell() {
  const t = useT()
  const number = useNumberFormat()
  const { formatRelative } = useDates()
  const [open, setOpen] = useState(false)
  const query = useQueryClient()
  const navigate = useNavigate()
  const count = useQuery({ queryKey: ['notifications', 'count'], queryFn: unreadCount })
  const items = useQuery({ queryKey: ['notifications', 'list'], queryFn: listNotifications, enabled: open })
  const unread = count.data?.count ?? 0
  const refresh = () => void query.invalidateQueries({ queryKey: ['notifications'] })
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon-sm" aria-label={unread ? t('app.notificationsUnread', { count: number(unread) }) : t('app.notifications')} className="relative">
        <Bell />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold text-primary-foreground">{unread > 99 ? '99+' : number(unread)}</span>}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-80">
      <div className="flex items-center justify-between px-2 py-1 text-xs font-semibold">
        <span>{t('app.notifications')} {unread > 0 && <span className="font-normal text-muted-foreground">{t('app.unread', { count: number(unread) })}</span>}</span>
        <Button size="xs" variant="ghost" disabled={unread === 0} onClick={() => void markAllRead().then(refresh, () => toast.error(t('app.markReadFailed')))}><CheckCheck />{t('app.markAllRead')}</Button>
      </div>
      <DropdownMenuSeparator />
      <div className="max-h-96 overflow-y-auto">
        {!items.data?.length && <p className="p-4 text-center text-xs text-muted-foreground">{t('app.noNotifications')}</p>}
        {items.data?.slice(0, 30).map((item) => <DropdownMenuItem key={item.id} className="flex flex-col items-start gap-0.5" onSelect={() => void markRead(item.id).then(() => { refresh(); void navigate(item.link) }, () => toast.error(t('app.markReadFailed')))}>
          <span className="flex w-full items-center gap-1.5 text-xs font-medium">{!item.read && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}<span className="truncate">{item.title}</span></span>
          <span className="w-full truncate text-xs text-muted-foreground">{item.body}</span>
          <span className="text-xs text-muted-foreground">{formatRelative(item.at)}</span>
        </DropdownMenuItem>)}
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
}
