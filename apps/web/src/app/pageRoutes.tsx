import { Navigate, useLocation, useRoutes, type RouteObject } from 'react-router'
import { Suspense } from 'react'
import { HomePage } from '@/features/home/HomePage'
import { PasswordPage } from '@/features/admin/PasswordPage'
import { MyInfoPage } from '@/features/admin/MyInfoPage'
import { useMe } from './auth'
import { lazyPage } from './lazyPage'
import { PageErrorBoundary } from './PageErrorBoundary'
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
const MyWorkPage = lazyPage(() => import('@/features/my-work/MyWorkPage'), (module) => module.MyWorkPage)
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

/** 셸 안의 화면들. 탭마다(또는 탭 줄이 없으면 한 번) 그 탭의 위치로 이 목록을 렌더한다 */
export const pageRoutes: RouteObject[] = [
  { index: true, element: <StaffOnly><HomePage /></StaffOnly> },
  { path: 'my-work', element: <StaffOnly><Lazy><MyWorkPage /></Lazy></StaffOnly> },
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
]

function PageRoutes() { return useRoutes(pageRoutes) }

/** 현재 위치(LocationContext)의 화면 하나 + 화면 오류 경계(셸은 유지) */
export function PageView() {
  const { pathname, search, hash } = useLocation()
  return <PageErrorBoundary resetKey={pathname + search + hash}><PageRoutes /></PageErrorBoundary>
}
