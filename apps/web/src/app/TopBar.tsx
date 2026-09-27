import { ChevronDown, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { UserAvatar } from '@/components/UserAvatar'
import { logout, useMe } from './auth'

interface TopBarProps {
  title?: React.ReactNode
  actions?: React.ReactNode
  onLoggedOut?: () => void
}

const goToLoggedOut = () => window.location.assign('/logged-out')

export function TopBar({ title, actions, onLoggedOut = goToLoggedOut }: TopBarProps) {
  const me = useMe()
  const isOwner = me.roles.includes('system_owner')

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-4">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
      {actions}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 pl-1.5">
            <UserAvatar user={{ ...me, initials: me.name.trim()[0] }} size="sm" />
            <span className="hidden sm:inline">{me.name}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {me.name}
            {isOwner && <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-primary">System Owner</span>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              logout().then(onLoggedOut, () => toast.error('로그아웃하지 못했습니다. 다시 시도하세요.'))
            }
          >
            <LogOut />
            로그아웃
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
