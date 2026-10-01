import { screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { AppShell } from './AppShell'

vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('./useEvents', () => ({ useEvents: () => undefined }))

afterEach(() => vi.unstubAllGlobals())

it('renders the forced password page with its avatar tooltip', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/me'
    ? jsonResponse(200, { id: 'u', name: '사용자', role: '', roles: ['member'], mustChangePassword: true })
    : jsonResponse(404)))
  renderWithProviders(<AppShell />)
  expect(await screen.findByText('비밀번호를 변경해야 계속할 수 있습니다')).toBeInTheDocument()
})

it('요청자에게 리포트 링크를 숨긴다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/me'
    ? jsonResponse(200, { id: 'requester', name: '요청자', role: '', roles: ['requester'], mustChangePassword: false })
    : jsonResponse(200, [])))
  renderWithProviders(<AppShell />)
  expect(await screen.findByRole('link', { name: 'SR 접수' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '리포트' })).not.toBeInTheDocument()
})
