import { createBrowserRouter, Navigate } from 'react-router'
import { Suspense } from 'react'
import { AppShell } from './AppShell'
import { LoggedOutPage } from './LoggedOutPage'
import { HomePage } from '@/features/home/HomePage'
import { LocalAuthPage } from './LocalAuthPage'
import { PasswordPage } from '@/features/admin/PasswordPage'
import { MyInfoPage } from '@/features/admin/MyInfoPage'
import { useMe } from './auth'
import { lazyPage } from './lazyPage'
import { RouteErrorPage } from './RouteErrorPage'
import { useT } from '@/i18n'
const DraftConversationPage = lazyPage(() => import('@/features/conversation/DraftConversationPage'), (module) => module.DraftConversationPage)
const TaskPage = lazyPage(() => import('@/features/task/TaskPage'), (module) => module.TaskPage)
const ManagePage = lazyPage(() => import('@/features/admin/ManagePage'), (module) => module.ManagePage)
const SettingsPage = lazyPage(() => import('@/features/admin/SettingsPage'), (module) => module.SettingsPage)
const UsersPage = lazyPage(() => import('@/features/admin/UsersPage'), (module) => module.UsersPage)
const DiagnosticsPage = lazyPage(() => import('@/features/admin/DiagnosticsPage'), (module) => module.DiagnosticsPage)
const SrIntakePage = lazyPage(() => import('@/features/sr/SrIntakePage'), (module) => module.SrIntakePage)
const SrManagePage = lazyPage(() => import('@/features/sr/SrManagePage'), (module) => module.SrManagePage)
const ReportsPage = lazyPage(() => import('@/features/reports/ReportsPage'), (module) => module.ReportsPage)
const LegacyTaskRedirect = lazyPage(() => import('@/features/task/TaskPage'), (module) => module.LegacyTaskRedirect)

/** chunk 로드 중 셸 안에 보이는 화면 뼈대 — TopBar 높이의 머리띠 + 본문 블록. 페이지별 뼈대는 각 화면 몫 */
function PageSkeleton() {
  const t = useT()
  return <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex flex-1 flex-col">
    <div className="flex h-12 shrink-0 items-center border-b bg-background px-4"><div className="h-4 w-40 animate-pulse rounded-md bg-muted" /></div>
    <div className="animate-pulse space-y-3 p-4"><div className="h-9 w-72 max-w-full rounded-lg bg-muted" /><div className="h-40 rounded-xl bg-muted" /><div className="h-24 rounded-xl bg-muted" /></div>
  </div>
}
const Lazy = ({ children }: { children: React.ReactNode }) => <Suspense fallback={<PageSkeleton />}>{children}</Suspense>

function OwnerOnly({ children }: { children: React.ReactNode }) {
  const me = useMe()
  return me.roles.includes('system_owner') ? children : <Navigate to={me.roles.includes('requester') ? '/sr' : '/'} replace />
}
export function StaffOnly({ children }: { children: React.ReactNode }) {
  const me = useMe()
  return me.roles.includes('system_owner') || !me.roles.includes('requester') ? children : <Navigate to="/sr" replace />
}

// errorElement 두 겹: 바깥은 셸 자체·로그인 화면 오류, 안쪽(pathless)은 페이지 오류를 셸을 유지한 채 보여 준다
export const router = createBrowserRouter([{ errorElement: <RouteErrorPage />, children: [
  { path: '/logged-out', element: <LoggedOutPage /> },
  { path: '/login', element: <LocalAuthPage kind="login" /> },
  { path: '/signup', element: <LocalAuthPage kind="signup" /> },
  {
    path: '/',
    element: <AppShell />,
    children: [{ errorElement: <RouteErrorPage />, children: [
      { index: true, element: <StaffOnly><HomePage /></StaffOnly> },
      { path: 'new/:assistantId', element: <StaffOnly><Lazy><DraftConversationPage /></Lazy></StaffOnly> },
      { path: 'sr', element: <Lazy><SrIntakePage /></Lazy> },
      { path: 'sr/manage', element: <StaffOnly><Lazy><SrManagePage /></Lazy></StaffOnly> },
      { path: 'reports', element: <StaffOnly><Lazy><ReportsPage /></Lazy></StaffOnly> },
      { path: 'c/:taskId', element: <StaffOnly><Lazy><TaskPage /></Lazy></StaffOnly> },
      { path: 'tasks/:taskId', element: <StaffOnly><Lazy><LegacyTaskRedirect /></Lazy></StaffOnly> },
      { path: 'assistants/manage', element: <OwnerOnly><Lazy><ManagePage /></Lazy></OwnerOnly> },
      { path: 'settings', element: <OwnerOnly><Lazy><SettingsPage /></Lazy></OwnerOnly> },
      { path: 'admin/users', element: <OwnerOnly><Lazy><UsersPage /></Lazy></OwnerOnly> },
      { path: 'admin/diagnostics', element: <OwnerOnly><Lazy><DiagnosticsPage /></Lazy></OwnerOnly> },
      { path: 'password', element: <PasswordPage /> },
      { path: 'my-info', element: <MyInfoPage /> },
      { path: '*', element: <StaffOnly><Navigate to="/" replace /></StaffOnly> },
    ] }],
  },
] }])
