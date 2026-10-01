import { createBrowserRouter, Navigate } from 'react-router'
import { AppShell } from './AppShell'
import { LoggedOutPage } from './LoggedOutPage'
import { HomePage } from '@/features/home/HomePage'
import { LocalAuthPage } from './LocalAuthPage'
import { DraftConversationPage } from '@/features/conversation/DraftConversationPage'
import { TaskPage, LegacyTaskRedirect } from '@/features/task/TaskPage'
import { ManagePage } from '@/features/admin/ManagePage'
import { SettingsPage } from '@/features/admin/SettingsPage'
import { PasswordPage } from '@/features/admin/PasswordPage'
import { useMe } from './auth'
import { SrIntakePage } from '@/features/sr/SrIntakePage'
import { SrManagePage } from '@/features/sr/SrManagePage'

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
      { path: 'new/:assistantId', element: <DraftConversationPage /> },
      { path: 'sr', element: <SrIntakePage /> },
      { path: 'sr/manage', element: <StaffOnly><SrManagePage /></StaffOnly> },
      { path: 'c/:taskId', element: <TaskPage /> },
      { path: 'tasks/:taskId', element: <LegacyTaskRedirect /> },
      { path: 'assistants/manage', element: <OwnerOnly><ManagePage /></OwnerOnly> },
      { path: 'settings', element: <OwnerOnly><SettingsPage /></OwnerOnly> },
      { path: 'password', element: <PasswordPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
