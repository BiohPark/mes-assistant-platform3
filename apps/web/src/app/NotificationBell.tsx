import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Bell, CheckCheck } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { listNotifications, markAllRead, markRead, unreadCount } from '@/api/notifications'
import { formatRelative } from '@/lib/dates'

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const query = useQueryClient()
  const navigate = useNavigate()
  const count = useQuery({ queryKey: ['notifications', 'count'], queryFn: unreadCount })
  const items = useQuery({ queryKey: ['notifications', 'list'], queryFn: listNotifications, enabled: open })
  const unread = count.data?.count ?? 0
  const refresh = () => void query.invalidateQueries({ queryKey: ['notifications'] })
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon-sm" aria-label={`알림${unread ? ` ${unread}건 미읽음` : ''}`} className="relative">
        <Bell />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-80">
      <div className="flex items-center justify-between px-2 py-1 text-xs font-semibold">
        <span>알림 {unread > 0 && <span className="font-normal text-muted-foreground">미읽음 {unread}</span>}</span>
        <Button size="xs" variant="ghost" disabled={unread === 0} onClick={() => void markAllRead().then(refresh, () => toast.error('알림을 읽음 처리하지 못했습니다.'))}><CheckCheck />모두 읽음</Button>
      </div>
      <DropdownMenuSeparator />
      <div className="max-h-96 overflow-y-auto">
        {!items.data?.length && <p className="p-4 text-center text-xs text-muted-foreground">알림이 없습니다.</p>}
        {items.data?.slice(0, 30).map((item) => <DropdownMenuItem key={item.id} className="flex flex-col items-start gap-0.5" onSelect={() => void markRead(item.id).then(() => { refresh(); void navigate(item.link) }, () => toast.error('알림을 읽음 처리하지 못했습니다.'))}>
          <span className="flex w-full items-center gap-1.5 text-xs font-medium">{!item.read && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}<span className="truncate">{item.title}</span></span>
          <span className="w-full truncate text-xs text-muted-foreground">{item.body}</span>
          <span className="text-xs text-muted-foreground">{formatRelative(item.at)}</span>
        </DropdownMenuItem>)}
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
}
