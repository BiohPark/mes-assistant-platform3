import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MeContext } from '@/app/auth'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { SrIntakePage } from './SrIntakePage'

vi.mock('@/app/TopBar', () => ({ TopBar: () => null }))
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

it.each([
  { roles: ['requester'] as const, theme: 'system' as const, locale: 'ko' as const, link: false },
  { roles: ['member', 'system_owner'] as const, theme: 'system' as const, locale: 'ko' as const, link: true },
])('접수 에이전트가 없으면 안내를 보이고 SO에게만 설정 링크를 준다: $roles', async ({ roles, link }) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/service-requests/intake-assistant' ? jsonResponse(200, { srIntakeAssistantId: null }) : jsonResponse(200, [])))
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: [...roles], theme: 'system' as const, locale: 'ko' as const }}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr' })
  expect(await screen.findByRole('status')).toHaveTextContent('System Owner가 설정에서 SR 접수 에이전트를 지정해야 합니다')
  expect(screen.queryByRole('button', { name: '새 요청' })).not.toBeInTheDocument()
  expect(!!screen.queryByRole('link', { name: '설정으로 이동' })).toBe(link)
})


it('접수 상태와 첨부를 읽을 수 있는 이름으로 표시하고 UUID는 숨긴다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/service-requests/internal-sr') return jsonResponse(200, {
      id: 'internal-sr', code: 'SR-2026-0001', requesterId: 'u', title: '요청', titleSource: 'manual', body: '', status: 'reviewing',
      threadId: 'thread', attachmentIds: [], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01',
    })
    if (url === '/api/threads/thread/messages') return jsonResponse(200, [{ id: 'm', threadId: 'thread', role: 'user', kind: 'chat', content: '요청 내용', createdAt: '2026-10-01', authorId: 'u', attachmentIds: ['internal-file-uuid'], status: 'done' }])
    if (url === '/api/service-requests?scope=mine') return jsonResponse(200, [{ id: 'internal-sr', code: 'SR-2026-0001', title: '요청', status: 'reviewing', createdAt: '2026-10-01', updatedAt: '2026-10-01' }])
    return jsonResponse(200, [])
  }))
  const { container } = renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['requester'], theme: 'system', locale: 'ko' }}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr?id=internal-sr' })
  expect(await screen.findAllByText('검토 중')).toHaveLength(3)
  expect(await screen.findByRole('link', { name: '첨부 1' })).toHaveAttribute('href', '/api/files/internal-file-uuid/content')
  expect(container).not.toHaveTextContent('internal-file-uuid')
  expect(screen.getByRole('button', { name: /SR-2026-0001/ })).toHaveTextContent('검토 중')
  expect(container).not.toHaveTextContent('reviewing')
})

it('새 요청 클릭은 저장하지 않고 첫 Enter 전송만 초안과 접수 요청을 1건씩 생성한다', async () => {
  const posts: Array<{ url: string; key: string | null }> = []
  const reads: string[] = []
  let rows: unknown[] = [], messages: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET') reads.push(url)
    if (init?.method === 'POST') posts.push({ url, key: new Headers(init.headers).get('Idempotency-Key') })
    if (url === '/api/service-requests/intake-assistant') return jsonResponse(200, { srIntakeAssistantId: 'a', name: '접수 도우미', summary: '요청을 정리합니다' })
    if (url === '/api/service-requests?scope=mine') return jsonResponse(200, rows)
    const sr = { id: 'created', threadId: 'intake', code: '', title: '', titleSource: 'default', body: '', status: 'draft', requesterId: 'u', attachmentIds: [], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }
    if (url === '/api/service-requests' && init?.method === 'POST') { rows = [sr]; return jsonResponse(201, sr) }
    if (url === '/api/service-requests/created') return jsonResponse(200, sr)
    if (url === '/api/threads/intake/messages') return jsonResponse(200, messages)
    if (url === '/api/threads/intake/requests') {
      messages = [{ id: 'm', threadId: 'intake', seq: 1, role: 'user', kind: 'chat', content: '알람 확인 요청', status: 'done', attachmentIds: [], createdAt: '2026-10-01', authorId: 'u' }]
      return new Response('event: started\ndata: {"requestId":"r","replyMessageId":"reply"}\n\nevent: completed\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } })
    }
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr' })
  await userEvent.click(await screen.findByRole('button', { name: '새 요청' }))
  expect(posts).toEqual([])
  expect(reads).not.toContain('/api/settings')
  expect(reads).not.toContain('/api/catalog/users')
  expect(screen.queryByRole('button', { name: '접수로 전환' })).not.toBeInTheDocument()
  expect(screen.getByText('접수 도우미')).toBeInTheDocument()
  await userEvent.type(screen.getByRole('textbox', { name: '접수 메시지' }), '알람 확인 요청{Enter}')
  await screen.findByText('알람 확인 요청')
  await waitFor(() => expect(posts).toHaveLength(2))
  expect(posts.map(post => post.url)).toEqual(['/api/service-requests', '/api/threads/intake/requests'])
  expect(posts.every(post => !!post.key)).toBe(true)
  expect(screen.getByRole('button', { name: '접수로 전환' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '팀 의견 (AI 미전송)' })).not.toBeInTheDocument()
})

it('첫 생성 응답을 잃으면 같은 멱등 키로 재시도하고 입력을 유지한다', async () => {
  const keys: Array<string | null> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/service-requests/intake-assistant') return jsonResponse(200, { srIntakeAssistantId: 'a' })
    if (url === '/api/service-requests' && init?.method === 'POST') {
      keys.push(new Headers(init.headers).get('Idempotency-Key'))
      throw new Error('연결 끊김')
    }
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr' })
  await userEvent.click(await screen.findByRole('button', { name: '새 요청' }))
  await userEvent.type(screen.getByRole('textbox', { name: '접수 메시지' }), '전송할 내용{Enter}')
  await waitFor(() => expect(keys).toHaveLength(1))
  expect(screen.getByRole('textbox', { name: '접수 메시지' })).toHaveValue('전송할 내용')
  await userEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(keys).toHaveLength(2))
  expect(keys[0]).toBeTruthy()
  expect(keys[1]).toBe(keys[0])
})

it('내 요청 목록은 진행/완료를 나누고 초안 삭제는 확인 후 요청한다', async () => {
  const draft = { id: 'draft', requesterId: 'u', code: '', title: '', firstMessage: '첫 메시지의 제목', titleSource: 'default', body: '', status: 'draft', threadId: 'thread', attachmentIds: [], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }
  let rows = [draft, { ...draft, id: 'closed', code: 'SR-2026-0002', title: '종료된 요청', status: 'done' }]
  let deletes = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/service-requests?scope=mine') return jsonResponse(200, rows)
    if (url === '/api/service-requests/draft' && init?.method === 'DELETE') { deletes++; rows = rows.filter(row => row.id !== 'draft'); return jsonResponse(204) }
    if (url === '/api/service-requests/draft') return jsonResponse(200, draft)
    if (url === '/api/service-requests/intake-assistant') return jsonResponse(200, { srIntakeAssistantId: 'a' })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr' })
  const listItem = await screen.findByRole('button', { name: /첫 메시지의 제목/ })
  expect(listItem).toHaveTextContent('대화 중')
  expect(screen.queryByRole('button', { name: /종료된 요청/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '완료' }))
  expect(screen.getByRole('button', { name: /종료된 요청/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /첫 메시지의 제목/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '진행 중' }))
  await userEvent.click(screen.getByRole('button', { name: /첫 메시지의 제목/ }))
  await userEvent.click(await screen.findByRole('button', { name: '초안 삭제' }))
  expect(deletes).toBe(0)
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: '취소' }))
  expect(deletes).toBe(0)
  await userEvent.click(screen.getByRole('button', { name: '초안 삭제' }))
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '초안 삭제' }))
  await waitFor(() => expect(deletes).toBe(1))
  await waitFor(() => expect(screen.queryByRole('button', { name: /첫 메시지의 제목/ })).not.toBeInTheDocument())
})

it.each(['done', 'rejected'])('%s 요청은 입력을 닫고 접수 내용은 읽기 전용으로 보여준다', async status => {
  const sr = { id: 'closed', requesterId: 'u', code: 'SR-2026-0001', title: '종료 요청', titleSource: 'manual', body: '접수 본문', status, threadId: 'thread', attachmentIds: [], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/service-requests/closed' ? jsonResponse(200, sr) : url === '/api/service-requests/intake-assistant' ? jsonResponse(200, { srIntakeAssistantId: 'a' }) : jsonResponse(200, [])))
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr?id=closed' })
  expect(await screen.findByText('접수 본문')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '접수 내용 보기' })).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: '접수 메시지' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '접수 내용 수정' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('완료 또는 반려된 요청은 메시지를 보낼 수 없습니다.')
})

it('첫 응답 시작을 기다리는 동안 새 요청·목록 이동을 막아 후속 입력 유실을 방지한다', async () => {
  let release!: (response: Response) => void
  let creates = 0
  const base = { requesterId: 'u', code: '', title: '', titleSource: 'default', body: '', status: 'draft', attachmentIds: [], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }
  const created = { ...base, id: 'created', threadId: 'intake' }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/service-requests/intake-assistant') return jsonResponse(200, { srIntakeAssistantId: 'a' })
    if (url === '/api/service-requests?scope=mine') return jsonResponse(200, [{ ...base, id: 'previous', threadId: 'previous-thread', title: '이전 요청' }])
    if (url === '/api/service-requests' && init?.method === 'POST') { creates++; return jsonResponse(201, created) }
    if (url === '/api/service-requests/created') return jsonResponse(200, created)
    if (url === '/api/threads/intake/requests') return new Promise<Response>(resolve => { release = resolve })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr' })
  await userEvent.click(await screen.findByRole('button', { name: '새 요청' }))
  await userEvent.type(screen.getByRole('textbox', { name: '접수 메시지' }), '첫 요청{Enter}')
  await waitFor(() => expect(release).toBeTypeOf('function'))
  expect(screen.getByRole('button', { name: '새 요청' })).toBeDisabled()
  expect(screen.getByRole('button', { name: /이전 요청/ })).toBeDisabled()
  // 첫 started 전에는 입력도 닫는다 — 열려 있으면 대기 중 attempt가 재사용되어 새 입력이 버려진다.
  expect(screen.getByRole('textbox', { name: '접수 메시지' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '전송' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: '새 요청' }))
  expect(creates).toBe(1)
  release(new Response('event: started\ndata: {"requestId":"r","replyMessageId":"reply"}\n\nevent: completed\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }))
  await waitFor(() => expect(screen.getByRole('button', { name: '새 요청' })).toBeEnabled())
  expect(screen.getByRole('textbox', { name: '접수 메시지' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: '새 요청' }))
  expect(screen.getByRole('textbox', { name: '접수 메시지' })).toHaveValue('')
})

it('요청 기록이 있는 초안은 삭제 버튼을 숨긴다(서버 hasRequests)', async () => {
  const draft = { id: 'draft', requesterId: 'u', code: '', title: '', firstMessage: '첫 메시지', titleSource: 'default', body: '', status: 'draft', threadId: 'thread', attachmentIds: [], results: [], conversations: [], hasRequests: true, createdAt: '2026-10-01', updatedAt: '2026-10-01' }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/service-requests?scope=mine') return jsonResponse(200, [draft])
    if (url === '/api/service-requests/draft') return jsonResponse(200, draft)
    if (url === '/api/service-requests/intake-assistant') return jsonResponse(200, { srIntakeAssistantId: 'a' })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr?id=draft' })
  expect(await screen.findByRole('textbox', { name: '접수 메시지' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '초안 삭제' })).not.toBeInTheDocument()
})

it('요청자(BO) 화면의 접수 첨부는 내려받기만 보이고 버전 기록은 숨긴다', async () => {
  const sr = { id: 'sr', requesterId: 'u', code: 'SR-2026-0001', title: '첨부 요청', titleSource: 'manual', body: '본문', status: 'reviewing', threadId: 'thread', attachmentIds: ['file'], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/service-requests/sr') return jsonResponse(200, sr)
    if (url === '/api/files/file') return jsonResponse(200, { id: 'file', name: '알람.txt', version: 1, size: 10, source: 'upload' })
    if (url === '/api/service-requests/intake-assistant') return jsonResponse(200, { srIntakeAssistantId: 'a' })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['requester'], theme: 'system', locale: 'ko' }}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr?id=sr' })
  expect(await screen.findByText('알람.txt v1')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '다운로드' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '버전 기록' })).not.toBeInTheDocument()
})
