import { createBrowserRouter, Navigate } from 'react-router'
import { lazy, Suspense } from 'react'
import { AppShell } from './AppShell'
import { LoggedOutPage } from './LoggedOutPage'
import { HomePage } from '@/features/home/HomePage'
import { LocalAuthPage } from './LocalAuthPage'
import { PasswordPage } from '@/features/admin/PasswordPage'
import { useMe } from './auth'
const DraftConversationPage = lazy(() => import('@/features/conversation/DraftConversationPage').then((module) => ({ default: module.DraftConversationPage })))
const TaskPage = lazy(() => import('@/features/task/TaskPage').then((module) => ({ default: module.TaskPage })))
const ManagePage = lazy(() => import('@/features/admin/ManagePage').then((module) => ({ default: module.ManagePage })))
const SettingsPage = lazy(() => import('@/features/admin/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const SrIntakePage = lazy(() => import('@/features/sr/SrIntakePage').then((module) => ({ default: module.SrIntakePage })))
const SrManagePage = lazy(() => import('@/features/sr/SrManagePage').then((module) => ({ default: module.SrManagePage })))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const LegacyTaskRedirect = lazy(() => import('@/features/task/TaskPage').then((module) => ({ default: module.LegacyTaskRedirect })))

function OwnerOnly({ children }: { children: React.ReactNode }) {
  const me = useMe()
  return me.roles.includes('system_owner') ? children : <Navigate to="/" replace />
}
function StaffOnly({ children }: { children: React.ReactNode }) {
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
      { index: true, element: <HomePage /> },
      { path: 'new/:assistantId', element: <Suspense fallback={null}><DraftConversationPage /></Suspense> },
      { path: 'sr', element: <Suspense fallback={null}><SrIntakePage /></Suspense> },
      { path: 'sr/manage', element: <StaffOnly><Suspense fallback={null}><SrManagePage /></Suspense></StaffOnly> },
      { path: 'reports', element: <Suspense fallback={null}><ReportsPage /></Suspense> },
      { path: 'c/:taskId', element: <Suspense fallback={null}><TaskPage /></Suspense> },
      { path: 'tasks/:taskId', element: <Suspense fallback={null}><LegacyTaskRedirect /></Suspense> },
      { path: 'assistants/manage', element: <OwnerOnly><Suspense fallback={null}><ManagePage /></Suspense></OwnerOnly> },
      { path: 'settings', element: <OwnerOnly><Suspense fallback={null}><SettingsPage /></Suspense></OwnerOnly> },
      { path: 'password', element: <PasswordPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
