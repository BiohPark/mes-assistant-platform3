import { ChevronDown, LogOut, KeyRound, Sparkles, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { LlmStatusSchema } from '@mes/contracts'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { UserAvatar } from '@/components/UserAvatar'
import { logout, useMe } from './auth'
import { localeOptions, themeOptions, useProfile } from './profile'
import type { Locale, Theme } from '@mes/contracts'
import { NotificationBell } from './NotificationBell'
import { useUiStore } from './uiStore'

interface TopBarProps {
  title?: React.ReactNode
  actions?: React.ReactNode
  onLoggedOut?: () => void
}

const goToLoggedOut = () => window.location.assign('/logged-out')

export function TopBar({ title, actions, onLoggedOut = goToLoggedOut }: TopBarProps) {
  const me = useMe()
  const profile = useProfile()
  const navigate = useNavigate()
  const isOwner = me.roles.includes('system_owner')
  const requesterOnly = me.roles.includes('requester') && !isOwner
  const setAssistantOpen = useUiStore((state) => state.setAssistantOpen)
  const llmStatus = useQuery({
    queryKey: ['llm', 'status'],
    enabled: isOwner && !me.mustChangePassword,
    queryFn: async () => {
      const response = await fetch('/api/llm/status', { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`LLM 상태 조회 실패 (HTTP ${response.status})`)
      return LlmStatusSchema.parse(await response.json())
    },
  })

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-4">
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>
      {actions}
      {!requesterOnly && <Button variant="ghost" size="icon-sm" aria-label="시스템 assistant 열기" onClick={() => setAssistantOpen(true)}><Sparkles /></Button>}
      {!requesterOnly && <NotificationBell />}
      {isOwner && llmStatus.data && <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{llmStatus.data.mode === 'mock' ? 'Mock' : 'Live'}</span>}
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
            {isOwner && <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-primary">System Owner</span>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>테마</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={profile.theme} onValueChange={(theme) => profile.save({ theme: theme as Theme })}>
            {themeOptions.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value} disabled={profile.pending}>{option.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>언어</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={profile.locale} onValueChange={(locale) => profile.save({ locale: locale as Locale })}>
            {localeOptions.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value} disabled={profile.pending}>{option.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void navigate('/my-info')}><UserRound />내 정보</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void navigate('/password')}><KeyRound />비밀번호 변경</DropdownMenuItem>
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
