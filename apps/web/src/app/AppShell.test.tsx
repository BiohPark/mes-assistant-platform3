import { screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { AppShell } from './AppShell'

vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('./useEvents', () => ({ useEvents: () => undefined }))

afterEach(() => vi.unstubAllGlobals())

it('renders the forced password page with its avatar tooltip', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/me'
    ? jsonResponse(200, { id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const, mustChangePassword: true })
    : jsonResponse(404)))
  renderWithProviders(<AppShell />)
  expect(await screen.findByText('비밀번호를 변경해야 계속할 수 있습니다')).toBeInTheDocument()
})

it('요청자(BO)는 메뉴 1개뿐이고 구획 머리말이 없다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/me'
    ? jsonResponse(200, { id: 'requester', name: '요청자', role: '', roles: ['requester'], theme: 'system' as const, locale: 'ko' as const, mustChangePassword: false })
    : jsonResponse(200, [])))
  renderWithProviders(<AppShell />)
  expect(await screen.findByRole('link', { name: '내 SR 요청' })).toBeInTheDocument()
  expect(within(screen.getByRole('navigation')).getAllByRole('link')).toHaveLength(1)
  for (const heading of ['업무', '요청', '관리']) expect(screen.queryByText(heading)).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '리포트' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '에이전트 허브' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '시스템 assistant 열기' })).not.toBeInTheDocument()
})

it('일반 담당자는 업무 3개 + 요청 1개 = 메뉴 4개, 머리말 2개', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/me'
    ? jsonResponse(200, { id: 'member', name: '담당자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const })
    : jsonResponse(200, [])))
  renderWithProviders(<AppShell />)
  expect(await screen.findByRole('link', { name: '내 SR 요청' })).toBeInTheDocument()
  const nav = screen.getByRole('navigation')
  expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['에이전트 허브', 'SR 처리', '리포트', '내 SR 요청'])
  expect(within(nav).getByText('업무')).toBeInTheDocument()
  expect(within(nav).getByText('요청')).toBeInTheDocument()
  expect(within(nav).queryByText('관리')).not.toBeInTheDocument()
})

it('SO는 업무·요청·관리 3구획 메뉴 8개를 본다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/me'
    ? jsonResponse(200, { id: 'owner', name: '관리자', role: '', roles: ['member', 'requester', 'system_owner'], theme: 'system' as const, locale: 'ko' as const })
    : jsonResponse(200, [])))
  renderWithProviders(<AppShell />)
  expect(await screen.findByRole('link', { name: '연결 진단' })).toBeInTheDocument()
  const nav = screen.getByRole('navigation')
  expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['에이전트 허브', 'SR 처리', '리포트', '내 SR 요청', '에이전트 관리', '전역 설정', '사용자 관리', '연결 진단'])
  expect(within(nav).getAllByText(/^(업무|요청|관리)$/).map((heading) => heading.textContent)).toEqual(['업무', '요청', '관리'])
  expect(screen.getByRole('link', { name: '사용자 관리' })).toHaveAttribute('href', '/admin/users')
  expect(screen.getByRole('link', { name: '연결 진단' })).toHaveAttribute('href', '/admin/diagnostics')
})

it('활성 메뉴는 accent 배경, 나머지 메뉴는 같은 스타일을 쓴다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/me'
    ? jsonResponse(200, { id: 'owner', name: '관리자', role: '', roles: ['member', 'requester', 'system_owner'], theme: 'system' as const, locale: 'ko' as const })
    : jsonResponse(200, [])))
  renderWithProviders(<AppShell />)
  const hub = await screen.findByRole('link', { name: '에이전트 허브' })
  expect(hub).toHaveAttribute('aria-current', 'page')
  expect(hub).toHaveClass('bg-accent')
  for (const name of ['내 SR 요청', '리포트', 'SR 처리', '에이전트 관리', '전역 설정', '사용자 관리', '연결 진단']) {
    const link = screen.getByRole('link', { name })
    expect(link).not.toHaveClass('bg-accent')
    expect(link).toHaveClass('rounded-lg')
    expect(link).toHaveAttribute('title', name)
  }
  expect(hub.closest('aside')).toHaveClass('bg-sidebar')
})
