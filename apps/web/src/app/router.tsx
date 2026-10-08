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
const DraftConversationPage = lazyPage(() => import('@/features/conversation/DraftConversationPage'), (module) => module.DraftConversationPage)
const TaskPage = lazyPage(() => import('@/features/task/TaskPage'), (module) => module.TaskPage)
const ManagePage = lazyPage(() => import('@/features/admin/ManagePage'), (module) => module.ManagePage)
const SettingsPage = lazyPage(() => import('@/features/admin/SettingsPage'), (module) => module.SettingsPage)
const DiagnosticsPage = lazyPage(() => import('@/features/admin/DiagnosticsPage'), (module) => module.DiagnosticsPage)
const SrIntakePage = lazyPage(() => import('@/features/sr/SrIntakePage'), (module) => module.SrIntakePage)
const SrManagePage = lazyPage(() => import('@/features/sr/SrManagePage'), (module) => module.SrManagePage)
const ReportsPage = lazyPage(() => import('@/features/reports/ReportsPage'), (module) => module.ReportsPage)
const LegacyTaskRedirect = lazyPage(() => import('@/features/task/TaskPage'), (module) => module.LegacyTaskRedirect)

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
      { path: 'new/:assistantId', element: <StaffOnly><Suspense fallback={null}><DraftConversationPage /></Suspense></StaffOnly> },
      { path: 'sr', element: <Suspense fallback={null}><SrIntakePage /></Suspense> },
      { path: 'sr/manage', element: <StaffOnly><Suspense fallback={null}><SrManagePage /></Suspense></StaffOnly> },
      { path: 'reports', element: <StaffOnly><Suspense fallback={null}><ReportsPage /></Suspense></StaffOnly> },
      { path: 'c/:taskId', element: <StaffOnly><Suspense fallback={null}><TaskPage /></Suspense></StaffOnly> },
      { path: 'tasks/:taskId', element: <StaffOnly><Suspense fallback={null}><LegacyTaskRedirect /></Suspense></StaffOnly> },
      { path: 'assistants/manage', element: <OwnerOnly><Suspense fallback={null}><ManagePage /></Suspense></OwnerOnly> },
      { path: 'settings', element: <OwnerOnly><Suspense fallback={null}><SettingsPage /></Suspense></OwnerOnly> },
      { path: 'admin/diagnostics', element: <OwnerOnly><Suspense fallback={null}><DiagnosticsPage /></Suspense></OwnerOnly> },
      { path: 'password', element: <PasswordPage /> },
      { path: 'my-info', element: <MyInfoPage /> },
      { path: '*', element: <StaffOnly><Navigate to="/" replace /></StaffOnly> },
    ] }],
  },
] }])
