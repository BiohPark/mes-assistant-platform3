import { createBrowserRouter } from 'react-router'
import { AppShell } from './AppShell'
import { LoggedOutPage } from './LoggedOutPage'
import { LocalAuthPage } from './LocalAuthPage'
import { RouteErrorPage } from './RouteErrorPage'

// 셸 아래 화면 목록은 pageRoutes — 셸이 탭마다 그 탭의 위치로 렌더한다(S15 MDI). 화면 오류는 PageErrorBoundary가 셸을 유지한 채 받는다
export const router = createBrowserRouter([{ errorElement: <RouteErrorPage />, children: [
  { path: '/logged-out', element: <LoggedOutPage /> },
  { path: '/login', element: <LocalAuthPage kind="login" /> },
  { path: '/signup', element: <LocalAuthPage kind="signup" /> },
  { path: '/*', element: <AppShell /> },
] }])
