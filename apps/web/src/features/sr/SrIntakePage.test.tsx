import { screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { SrIntakePage } from './SrIntakePage'

vi.mock('@/app/TopBar', () => ({ TopBar: () => null }))
vi.mock('@/features/chat/useChat', () => ({ useChat: () => ({ send: vi.fn(), run: null }) }))
afterEach(() => vi.unstubAllGlobals())

it.each([
  { roles: ['requester'] as const, link: false },
  { roles: ['member', 'system_owner'] as const, link: true },
])('접수 에이전트가 없으면 안내를 보이고 SO에게만 설정 링크를 준다: $roles', async ({ roles, link }) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/settings' ? jsonResponse(200, {}) : jsonResponse(200, [])))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: [...roles] }}><SrIntakePage /></MeContext>, { route: '/sr' })
  expect(await screen.findByRole('status')).toHaveTextContent('System Owner가 설정에서 SR 접수 에이전트를 지정해야 합니다')
  expect(screen.queryByRole('button', { name: '접수 대화 시작' })).not.toBeInTheDocument()
  expect(!!screen.queryByRole('link', { name: '설정으로 이동' })).toBe(link)
})
