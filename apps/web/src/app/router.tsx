import { createBrowserRouter, Navigate } from 'react-router'
import { lazy, Suspense } from 'react'
import { AppShell } from './AppShell'
import { LoggedOutPage } from './LoggedOutPage'
import { HomePage } from '@/features/home/HomePage'
import { LocalAuthPage } from './LocalAuthPage'
import { PasswordPage } from '@/features/admin/PasswordPage'
import { MyInfoPage } from '@/features/admin/MyInfoPage'
import { useMe } from './auth'
const DraftConversationPage = lazy(() => import('@/features/conversation/DraftConversationPage').then((module) => ({ default: module.DraftConversationPage })))
const TaskPage = lazy(() => import('@/features/task/TaskPage').then((module) => ({ default: module.TaskPage })))
const ManagePage = lazy(() => import('@/features/admin/ManagePage').then((module) => ({ default: module.ManagePage })))
const SettingsPage = lazy(() => import('@/features/admin/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const DiagnosticsPage = lazy(() => import('@/features/admin/DiagnosticsPage').then((module) => ({ default: module.DiagnosticsPage })))
const SrIntakePage = lazy(() => import('@/features/sr/SrIntakePage').then((module) => ({ default: module.SrIntakePage })))
const SrManagePage = lazy(() => import('@/features/sr/SrManagePage').then((module) => ({ default: module.SrManagePage })))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const LegacyTaskRedirect = lazy(() => import('@/features/task/TaskPage').then((module) => ({ default: module.LegacyTaskRedirect })))

function OwnerOnly({ children }: { children: React.ReactNode }) {
  const me = useMe()
  return me.roles.includes('system_owner') ? children : <Navigate to={me.roles.includes('requester') ? '/sr' : '/'} replace />
}
export function StaffOnly({ children }: { children: React.ReactNode }) {
  const me = useMe()
  return me.roles.includes('system_owner') || !me.roles.includes('requester') ? children : <Navigate to="/sr" replace />
}

export const router = createBrowserRouter([
  { path: '/logged-out', element: <LoggedOutPage /> },
  { path: '/login', element: <LocalAuthPage kind="login" /> },
  { path: '/signup', element: <LocalAuthPage kind="signup" /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
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
    ],
  },
])
