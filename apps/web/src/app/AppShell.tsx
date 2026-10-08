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

const NAV = [{ to: '/', label: 'nav.hub', icon: LayoutGrid, end: true }] as const

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
          <aside className="flex w-14 shrink-0 flex-col items-center border-r bg-sidebar py-3 lg:w-52 lg:items-stretch lg:px-3">
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
              {!requesterOnly && <p className="hidden px-2 text-xs text-muted-foreground lg:block">{t('nav.work')}</p>}
              {!requesterOnly && NAV.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  title={t(label)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                      isActive && 'bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary',
                    )
                  }
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="hidden lg:inline">{t(label)}</span>
                </NavLink>
              ))}
              {(!me.roles.includes('requester') || me.roles.includes('system_owner')) && <NavLink to="/sr/manage" title={t('nav.srManage')} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted"><Inbox className="size-4" /><span className="hidden lg:inline">{t('nav.srManage')}</span></NavLink>}
              {(!me.roles.includes('requester') || me.roles.includes('system_owner')) && <NavLink to="/reports" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted"><BarChart3 className="size-4" /><span className="hidden lg:inline">{t('nav.reports')}</span></NavLink>}
              <p className="mt-3 hidden px-2 text-xs text-muted-foreground lg:block">{t('nav.requests')}</p>
              <NavLink to="/sr" end title={t('nav.sr')} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted"><Send className="size-4" /><span className="hidden lg:inline">{t('nav.sr')}</span></NavLink>
              {me.roles.includes('system_owner') && <>
                <NavLink to="/assistants/manage" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted"><Bot className="size-4" /><span className="hidden lg:inline">{t('nav.assistants')}</span></NavLink>
                <NavLink to="/settings" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted"><Settings className="size-4" /><span className="hidden lg:inline">{t('nav.settings')}</span></NavLink>
                <NavLink to="/admin/diagnostics" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted"><Activity className="size-4" /><span className="hidden lg:inline">{t('nav.diagnostics')}</span></NavLink>
              </>}
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
