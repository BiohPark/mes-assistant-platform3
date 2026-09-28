import { createBrowserRouter, Navigate } from 'react-router'
import { AppShell } from './AppShell'
import { LoggedOutPage } from './LoggedOutPage'
import { HomePage } from '@/features/home/HomePage'
import { LocalAuthPage } from './LocalAuthPage'
import { DraftConversationPage } from '@/features/conversation/DraftConversationPage'
import { TaskPage, LegacyTaskRedirect } from '@/features/task/TaskPage'

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
      { path: 'c/:taskId', element: <TaskPage /> },
      { path: 'tasks/:taskId', element: <LegacyTaskRedirect /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
