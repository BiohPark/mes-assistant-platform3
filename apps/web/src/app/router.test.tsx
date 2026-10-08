import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from './auth'
import { router } from './router'

let roles: Array<'member' | 'requester' | 'system_owner'> = ['requester']
let homeError: Error | undefined
// 지연 import를 흉내 내는 관문: 테스트가 resolve를 호출하기 전까지 chunk가 도착하지 않는다 (모듈 레지스트리는 파일 단위라 각 1회)
const gates = vi.hoisted(() => {
  function gate() { let resolve = () => {}; const promise = new Promise<void>((done) => { resolve = done }); return { promise, resolve } }
  return { reports: gate(), diagnostics: gate() }
})
vi.mock('./AppShell', () => ({ AppShell: () => <MeContext value={{ theme: 'system', locale: 'ko', id: 'u', name: '사용자', role: '', roles }}><span>shell</span><Outlet /></MeContext> }))
vi.mock('@/features/home/HomePage', () => ({ HomePage: () => { if (homeError) throw homeError; return <div>허브 화면</div> } }))
vi.mock('@/features/sr/SrIntakePage', () => ({ SrIntakePage: () => <div>SR 접수 화면</div> }))
vi.mock('@/features/reports/ReportsPage', async () => { await gates.reports.promise; return { ReportsPage: () => <div>리포트 화면</div> } })
vi.mock('@/features/admin/DiagnosticsPage', async () => { await gates.diagnostics.promise; return { DiagnosticsPage: () => <div>진단 화면</div> } })

afterEach(() => { roles = ['requester']; homeError = undefined; vi.restoreAllMocks() })

it.each(['/', '/new/agent', '/c/task', '/reports', '/sr/manage', '/tasks/task', '/settings', '/admin/users', '/admin/diagnostics', '/assistants/manage'])('BO는 %s에서 /sr로 이동한다', async (path) => {
  const memory = createMemoryRouter(router.routes, { initialEntries: [path] })
  render(<RouterProvider router={memory} />)
  await waitFor(() => expect(memory.state.location.pathname).toBe('/sr'))
})

it.each(['/settings', '/admin/users', '/admin/diagnostics', '/assistants/manage'])('일반 담당자는 %s에서 허브로 이동한다', async (path) => {
  roles = ['member']
  const memory = createMemoryRouter(router.routes, { initialEntries: [path] })
  render(<RouterProvider router={memory} />)
  await waitFor(() => expect(memory.state.location.pathname).toBe('/'))
})

it('일반 담당자는 허브에 진입한다', async () => {
  roles = ['member']
  const memory = createMemoryRouter(router.routes, { initialEntries: ['/'] })
  render(<RouterProvider router={memory} />)
  await waitFor(() => expect(memory.state.location.pathname).toBe('/'))
  expect(screen.getByText('허브 화면')).toBeInTheDocument()
})

it('SO는 허브에 진입한다', async () => {
  roles = ['member', 'requester', 'system_owner']
  const memory = createMemoryRouter(router.routes, { initialEntries: ['/'] })
  render(<RouterProvider router={memory} />)
  await waitFor(() => expect(memory.state.location.pathname).toBe('/'))
  expect(screen.getByText('허브 화면')).toBeInTheDocument()
})

it.each([
  ['/reports', ['member'], gates.reports, '리포트 화면'],
  ['/admin/diagnostics', ['member', 'system_owner'], gates.diagnostics, '진단 화면'],
] as const)('%s는 chunk가 올 때까지 셸 안에 뼈대를 보이고, 도착하면 내용으로 바꾼다', async (path, allowed, gate, content) => {
  roles = [...allowed]
  const memory = createMemoryRouter(router.routes, { initialEntries: [path] })
  render(<RouterProvider router={memory} />)
  const skeleton = await screen.findByRole('status', { name: '불러오는 중…' })
  expect(skeleton).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByText('shell')).toBeInTheDocument()
  expect(screen.queryByText(content)).not.toBeInTheDocument()
  gate.resolve()
  expect(await screen.findByText(content)).toBeInTheDocument()
  expect(screen.queryByRole('status', { name: '불러오는 중…' })).not.toBeInTheDocument()
})

it('화면 오류는 셸을 유지한 채 앱 스타일 오류 화면으로 보여 준다', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  roles = ['member']
  homeError = new Error('boom')
  const memory = createMemoryRouter(router.routes, { initialEntries: ['/'] })
  render(<RouterProvider router={memory} />)
  expect(await screen.findByRole('heading', { name: '화면을 표시할 수 없습니다' })).toBeInTheDocument()
  expect(screen.getByText('shell')).toBeInTheDocument()
  expect(screen.queryByText('Unexpected Application Error!')).not.toBeInTheDocument()
})
