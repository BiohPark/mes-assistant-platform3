import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from './auth'
import { router } from './router'

let roles: Array<'member' | 'requester' | 'system_owner'> = ['requester']
let homeError: Error | undefined
vi.mock('./AppShell', () => ({ AppShell: () => <MeContext value={{ theme: 'system', locale: 'ko', id: 'u', name: '사용자', role: '', roles }}><span>shell</span><Outlet /></MeContext> }))
vi.mock('@/features/home/HomePage', () => ({ HomePage: () => { if (homeError) throw homeError; return <div>허브 화면</div> } }))
vi.mock('@/features/sr/SrIntakePage', () => ({ SrIntakePage: () => <div>SR 접수 화면</div> }))

afterEach(() => { roles = ['requester']; homeError = undefined; vi.restoreAllMocks() })

it.each(['/', '/new/agent', '/c/task', '/reports', '/sr/manage', '/tasks/task', '/settings', '/admin/diagnostics', '/assistants/manage'])('BO는 %s에서 /sr로 이동한다', async (path) => {
  const memory = createMemoryRouter(router.routes, { initialEntries: [path] })
  render(<RouterProvider router={memory} />)
  await waitFor(() => expect(memory.state.location.pathname).toBe('/sr'))
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
