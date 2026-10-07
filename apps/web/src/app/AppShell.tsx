import { NavLink, Outlet } from 'react-router'
import { LayoutGrid, Boxes, Settings, Bot, ClipboardList, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthGate } from './AuthGate'
import { useEvents } from './useEvents'
import { useMe } from './auth'
import { PasswordPage } from '@/features/admin/PasswordPage'
import { SystemAssistantDrawer } from '@/features/system-assistant/SystemAssistantDrawer'

function LiveEvents() { useEvents(); return null }

const NAV = [{ to: '/', label: '에이전트 허브', icon: LayoutGrid, end: true }]

export function AppShell() {
  return (
    <AuthGate>
      <TooltipProvider><AppContent /></TooltipProvider>
    </AuthGate>
  )
}

function AppContent() {
  const me = useMe()
  const requesterOnly = me.roles.includes('requester') && !me.roles.includes('system_owner')
  if (me.mustChangePassword) return <PasswordPage />
  return (
    <>
      <LiveEvents />
        <div className="flex h-full bg-muted/30">
          <aside className="flex w-14 shrink-0 flex-col items-center border-r bg-sidebar py-3 lg:w-52 lg:items-stretch lg:px-3">
            <div className="mb-4 flex items-center gap-2 px-1 lg:px-1">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Boxes className="size-4" />
              </span>
              <div className="hidden leading-tight lg:block">
                <div className="text-sm font-semibold">MES Agent Hub</div>
                <div className="text-[10px] text-muted-foreground">대화 · 태그 · SR</div>
              </div>
            </div>
            <nav className="flex flex-col gap-1">
              {!requesterOnly && NAV.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  title={label}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                      isActive && 'bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary',
                    )
                  }
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="hidden lg:inline">{label}</span>
                </NavLink>
              ))}
              <NavLink to="/sr" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted"><ClipboardList className="size-4" /><span className="hidden lg:inline">SR 접수</span></NavLink>
              {(!me.roles.includes('requester') || me.roles.includes('system_owner')) && <NavLink to="/reports" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted"><BarChart3 className="size-4" /><span className="hidden lg:inline">리포트</span></NavLink>}
              {(!me.roles.includes('requester') || me.roles.includes('system_owner')) && <NavLink to="/sr/manage" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted"><ClipboardList className="size-4" /><span className="hidden lg:inline">SR 관리</span></NavLink>}
              {me.roles.includes('system_owner') && <>
                <NavLink to="/assistants/manage" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted"><Bot className="size-4" /><span className="hidden lg:inline">에이전트 관리</span></NavLink>
                <NavLink to="/settings" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted"><Settings className="size-4" /><span className="hidden lg:inline">설정</span></NavLink>
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
