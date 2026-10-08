import { Fragment } from 'react'
import { NavLink, Outlet } from 'react-router'
import { LayoutGrid, Boxes, Settings, Bot, Send, Inbox, BarChart3, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthGate } from './AuthGate'
import { useEvents } from './useEvents'
import { useMe } from './auth'
import { PasswordPage } from '@/features/admin/PasswordPage'
import { SystemAssistantDrawer } from '@/features/system-assistant/SystemAssistantDrawer'
import { useT } from '@/i18n'

function LiveEvents() { useEvents(); return null }

type Roles = ReadonlyArray<string>
const member = (roles: Roles) => !roles.includes('requester') || roles.includes('system_owner')
const owner = (roles: Roles) => roles.includes('system_owner')
/** 사이드바 메뉴 한 배열. section 머리말은 첫 항목 앞에만 붙고, show가 없으면 모두에게 보인다 */
const NAV = [
  { to: '/', label: 'nav.hub', icon: LayoutGrid, end: true, section: 'nav.work', show: member },
  { to: '/sr/manage', label: 'nav.srManage', icon: Inbox, section: 'nav.work', show: member },
  { to: '/reports', label: 'nav.reports', icon: BarChart3, section: 'nav.work', show: member },
  { to: '/sr', label: 'nav.sr', icon: Send, end: true, section: 'nav.requests' },
  { to: '/assistants/manage', label: 'nav.assistants', icon: Bot, section: 'nav.requests', show: owner },
  { to: '/settings', label: 'nav.settings', icon: Settings, section: 'nav.requests', show: owner },
  { to: '/admin/diagnostics', label: 'nav.diagnostics', icon: Activity, section: 'nav.requests', show: owner },
] as const

export function AppShell() {
  return (
    <AuthGate>
      <TooltipProvider><AppContent /></TooltipProvider>
    </AuthGate>
  )
}

function AppContent() {
  const t = useT()
  const me = useMe()
  const requesterOnly = me.roles.includes('requester') && !me.roles.includes('system_owner')
  if (me.mustChangePassword) return <PasswordPage />
  return (
    <>
      {!requesterOnly && <LiveEvents />}
        <div className="flex h-full bg-muted/30">
          <aside className="flex w-14 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-3 text-sidebar-foreground lg:w-52 lg:items-stretch lg:px-3">
            <div className="mb-4 flex items-center gap-2 px-1 lg:px-1">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Boxes className="size-4" />
              </span>
              <div className="hidden leading-tight lg:block">
                <div className="text-sm font-semibold">{t('common.appName')}</div>
                <div className="text-xs text-muted-foreground">{t('common.tagline')}</div>
              </div>
            </div>
            <nav className="flex flex-col gap-1">
              {NAV.filter((item) => !('show' in item) || item.show(me.roles)).map((item, index, items) => (
                <Fragment key={item.to}>
                  {items[index - 1]?.section !== item.section && <p className={cn('hidden px-2 text-xs text-muted-foreground lg:block', index > 0 && 'mt-3')}>{t(item.section)}</p>}
                  <NavLink
                    to={item.to}
                    end={'end' in item && item.end}
                    title={t(item.label)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                        isActive && 'bg-accent font-medium text-accent-foreground hover:bg-accent hover:text-accent-foreground',
                      )
                    }
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="hidden lg:inline">{t(item.label)}</span>
                  </NavLink>
                </Fragment>
              ))}
            </nav>
          </aside>
          <main className="flex min-w-0 flex-1 flex-col">
            <Outlet />
          </main>
        </div>
        {!requesterOnly && <SystemAssistantDrawer />}
        <Toaster position="bottom-right" richColors closeButton />
    </>
  )
}
