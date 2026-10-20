import { useT } from '@/i18n'
import { ChevronDown, Languages, LogOut, KeyRound, Moon, Sun, UserRound } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Link, useNavigate } from 'react-router'
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
import { isPopout } from './popout'
import { localeOptions, themeOptions, useProfile } from './profile'
import type { Locale, Theme } from '@mes/contracts'
import { NotificationBell } from './NotificationBell'
import { clearDrafts } from '@/features/chat/drafts'
import { clearRailState } from '@/features/task/materialsDrawer'

interface TopBarProps {
  title?: React.ReactNode
  actions?: React.ReactNode
  onLoggedOut?: () => void
}

const goToLoggedOut = () => window.location.assign('/logged-out')

export function TopBar({ title, actions, onLoggedOut = goToLoggedOut }: TopBarProps) {
  const t = useT()
  const me = useMe()
  const profile = useProfile()
  const navigate = useNavigate()
  // 상단 토글은 지금 보이는 테마의 반대로 바꾼다('시스템 설정'이면 실제 적용된 쪽 기준). 저장은 메뉴와 같은 profile.save
  const dark = (useTheme().resolvedTheme ?? profile.theme) === 'dark'
  const isOwner = me.roles.includes('system_owner')
  const requesterOnly = me.roles.includes('requester') && !isOwner
  const popout = isPopout() // 대화 팝업 창 — 제목(과 actions)만, 내비·상태 조회 없음
  const llmStatus = useQuery({
    queryKey: ['llm', 'status'],
    enabled: isOwner && !me.mustChangePassword && !popout,
    queryFn: async () => {
      const response = await fetch('/api/llm/status', { credentials: 'same-origin' })
      if (!response.ok) throw new Error(t('common.llmStatusFailed', { status: response.status }))
      return LlmStatusSchema.parse(await response.json())
    },
  })

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-4">
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>
      {actions}
      {!popout && <>
      <Button variant="ghost" size="icon-sm" aria-label={t(dark ? 'common.switchToLight' : 'common.switchToDark')} title={t(dark ? 'common.switchToLight' : 'common.switchToDark')} disabled={profile.pending} onClick={() => profile.save({ theme: dark ? 'light' : 'dark' })}>
        {dark ? <Sun /> : <Moon />}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={t('common.switchLanguage')} title={t('common.switchLanguage')} disabled={profile.pending} onClick={() => profile.save({ locale: profile.locale === 'ko' ? 'en' : 'ko' })}>
        <Languages />
      </Button>
      {!requesterOnly && <NotificationBell />}
      {isOwner && llmStatus.data && <Link to="/admin/diagnostics" aria-label={t('admin.diagnostics.badge', { mode: llmStatus.data.mode === 'mock' ? 'Mock' : 'Live' })} className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">{llmStatus.data.mode === 'mock' ? 'Mock' : 'Live'}</Link>}
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
          <DropdownMenuLabel>{t('common.theme')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={profile.theme} onValueChange={(theme) => profile.save({ theme: theme as Theme })}>
            {themeOptions.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value} disabled={profile.pending}>{t(option.key)}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('common.language')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={profile.locale} onValueChange={(locale) => profile.save({ locale: locale as Locale })}>
            {localeOptions.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value} disabled={profile.pending}>{t(option.key)}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void navigate('/my-info')}><UserRound />{t('common.myInfo')}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void navigate('/password')}><KeyRound />{t('common.changePassword')}</DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              logout().then(() => { profile.reset(); clearDrafts(); clearRailState(); onLoggedOut() }, () => toast.error(t('common.logoutFailed')))
            }
          >
            <LogOut />
            {t('common.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </>}
    </header>
  )
}
