import { screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { AppShell } from './AppShell'

afterEach(() => vi.unstubAllGlobals())

it('renders the forced password page with its avatar tooltip', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/me'
    ? jsonResponse(200, { id: 'u', name: '사용자', role: '', roles: ['member'], mustChangePassword: true })
    : jsonResponse(404)))
  renderWithProviders(<AppShell />)
  expect(await screen.findByText('비밀번호를 변경해야 계속할 수 있습니다')).toBeInTheDocument()
})
