import { createBrowserRouter, Navigate } from 'react-router'
import { AppShell } from './AppShell'
import { LoggedOutPage } from './LoggedOutPage'
import { HomePage } from '@/features/home/HomePage'

export const router = createBrowserRouter([
  { path: '/logged-out', element: <LoggedOutPage /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
