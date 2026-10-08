import { screen } from '@testing-library/react'
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

it('요청자에게 리포트 링크를 숨긴다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/me'
    ? jsonResponse(200, { id: 'requester', name: '요청자', role: '', roles: ['requester'], theme: 'system' as const, locale: 'ko' as const, mustChangePassword: false })
    : jsonResponse(200, [])))
  renderWithProviders(<AppShell />)
  expect(await screen.findByRole('link', { name: '내 SR 요청' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '리포트' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '에이전트 허브' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '시스템 assistant 열기' })).not.toBeInTheDocument()
})

it('일반 담당자에게 SR 접수 메뉴를 보인다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/me'
    ? jsonResponse(200, { id: 'member', name: '담당자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const })
    : jsonResponse(200, [])))
  renderWithProviders(<AppShell />)
  expect(await screen.findByRole('link', { name: '내 SR 요청' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '에이전트 허브' })).toBeInTheDocument()
})

it('SO에게 모든 메뉴를 보인다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/me'
    ? jsonResponse(200, { id: 'owner', name: '관리자', role: '', roles: ['member', 'requester', 'system_owner'], theme: 'system' as const, locale: 'ko' as const })
    : jsonResponse(200, [])))
  renderWithProviders(<AppShell />)
  for (const name of ['에이전트 허브', '내 SR 요청', '리포트', 'SR 처리', '에이전트 관리', '설정']) {
    expect(await screen.findByRole('link', { name })).toBeInTheDocument()
  }
})
