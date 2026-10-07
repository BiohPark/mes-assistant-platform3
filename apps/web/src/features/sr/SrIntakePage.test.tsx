import { screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { SrIntakePage } from './SrIntakePage'

vi.mock('@/app/TopBar', () => ({ TopBar: () => null }))
vi.mock('@/features/chat/useChat', () => ({ useChat: () => ({ send: vi.fn(), run: null }) }))
afterEach(() => vi.unstubAllGlobals())

it.each([
  { roles: ['requester'] as const, theme: 'system' as const, locale: 'ko' as const, link: false },
  { roles: ['member', 'system_owner'] as const, theme: 'system' as const, locale: 'ko' as const, link: true },
])('접수 에이전트가 없으면 안내를 보이고 SO에게만 설정 링크를 준다: $roles', async ({ roles, link }) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/service-requests/intake-assistant' ? jsonResponse(200, { srIntakeAssistantId: null }) : jsonResponse(200, [])))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: [...roles], theme: 'system' as const, locale: 'ko' as const }}><SrIntakePage /></MeContext>, { route: '/sr' })
  expect(await screen.findByRole('status')).toHaveTextContent('System Owner가 설정에서 SR 접수 에이전트를 지정해야 합니다')
  expect(screen.queryByRole('button', { name: '접수 대화 시작' })).not.toBeInTheDocument()
  expect(!!screen.queryByRole('link', { name: '설정으로 이동' })).toBe(link)
})


it('접수 상태와 첨부를 읽을 수 있는 이름으로 표시하고 UUID는 숨긴다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/service-requests/internal-sr') return jsonResponse(200, {
      id: 'internal-sr', code: 'SR-2026-0001', requesterId: 'u', title: '요청', titleSource: 'manual', body: '', status: 'reviewing',
      threadId: 'thread', attachmentIds: [], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01',
    })
    if (url === '/api/threads/thread/messages') return jsonResponse(200, [{ id: 'm', threadId: 'thread', role: 'user', kind: 'chat', content: '요청 내용', createdAt: '2026-10-01', authorId: 'u', attachmentIds: ['internal-file-uuid'], status: 'done' }])
    if (url === '/api/service-requests') return jsonResponse(200, [{ id: 'internal-sr', code: 'SR-2026-0001', title: '요청', status: 'reviewing' }])
    return jsonResponse(200, [])
  }))
  const { container } = renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['requester'], theme: 'system', locale: 'ko' }}><SrIntakePage /></MeContext>, { route: '/sr?id=internal-sr' })
  expect(await screen.findAllByText('검토 중')).toHaveLength(2)
  expect(await screen.findByRole('link', { name: '첨부 1' })).toHaveAttribute('href', '/api/files/internal-file-uuid/content')
  expect(container).not.toHaveTextContent('internal-file-uuid')
  expect(screen.getByRole('button', { name: /SR-2026-0001/ })).toHaveTextContent('검토 중')
  expect(container).not.toHaveTextContent('reviewing')
})
