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
      threadId: 'thread', attachmentIds: [], candidateAttachmentIds: [], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01',
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
    const sr = { id: 'created', threadId: 'intake', code: '', title: '', titleSource: 'default', body: '', status: 'draft', requesterId: 'u', attachmentIds: [], candidateAttachmentIds: [], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }
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
  expect(screen.getAllByText('접수 도우미').length).toBeGreaterThan(0)
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
  const draft = { id: 'draft', requesterId: 'u', code: '', title: '', firstMessage: '첫 메시지의 제목', titleSource: 'default', body: '', status: 'draft', threadId: 'thread', attachmentIds: [], candidateAttachmentIds: [], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }
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
  const sr = { id: 'closed', requesterId: 'u', code: 'SR-2026-0001', title: '종료 요청', titleSource: 'manual', body: '접수 본문', status, threadId: 'thread', attachmentIds: [], candidateAttachmentIds: [], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }
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
  const base = { requesterId: 'u', code: '', title: '', titleSource: 'default', body: '', status: 'draft', attachmentIds: [], candidateAttachmentIds: [], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }
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
  const draft = { id: 'draft', requesterId: 'u', code: '', title: '', firstMessage: '첫 메시지', titleSource: 'default', body: '', status: 'draft', threadId: 'thread', attachmentIds: [], candidateAttachmentIds: [], results: [], conversations: [], hasRequests: true, createdAt: '2026-10-01', updatedAt: '2026-10-01' }
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
  const sr = { id: 'sr', requesterId: 'u', code: 'SR-2026-0001', title: '첨부 요청', titleSource: 'manual', body: '본문', status: 'reviewing', threadId: 'thread', attachmentIds: ['file'], candidateAttachmentIds: ['file'], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }
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

it('접수자 화면에서 상태 이력을 펼치면 시각·처리자·변경·사유가 보인다', async () => {
  const sr = { id: 'sr', requesterId: 'u', code: 'SR-2026-0001', title: '이력 요청', titleSource: 'manual', body: '본문', status: 'rejected', threadId: 'thread', attachmentIds: [], candidateAttachmentIds: [], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01',
    statusHistory: [{ id: 'h1', at: '2026-10-01T01:00:00.000Z', by: 'u', byName: '사용자', from: 'draft', to: 'submitted' }, { id: 'h2', at: '2026-10-02T02:00:00.000Z', by: 's', byName: '담당자', from: 'submitted', to: 'rejected', reason: '범위 밖 요청' }] }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/service-requests/sr' ? jsonResponse(200, sr) : url === '/api/service-requests/intake-assistant' ? jsonResponse(200, { srIntakeAssistantId: 'a' }) : jsonResponse(200, [])))
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['requester'], theme: 'system', locale: 'ko' }}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr?id=sr' })
  await userEvent.click(await screen.findByRole('button', { name: '상태 이력' }))
  const list = screen.getByRole('list', { name: '상태 이력' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('담당자')
  expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('접수됨 → 반려')
  expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('사유: 범위 밖 요청')
})

const me = { id: 'u', name: '사용자', role: '', roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }
const intake = { srIntakeAssistantId: 'a', name: '접수 도우미', summary: '요청을 정리합니다', usageExample: '### 사용법\n- 시작\n- "설비 알람 확인"\n- 첨부 파일을 올리세요\n- "리포트 요청"' }
const row = (id: string, status: string) => ({ id, requesterId: 'u', code: `SR-${id}`, title: `요청 ${id}`, titleSource: 'manual', body: '', status, threadId: `thread-${id}`, attachmentIds: [], candidateAttachmentIds: [], results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' })

it('목록·접수 에이전트를 불러오는 동안 뼈대를 보이고 끝나면 치운다', async () => {
  let release!: () => void
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/service-requests?scope=mine') { await new Promise<void>(resolve => { release = resolve }); return jsonResponse(200, [row('x', 'submitted')]) }
    if (url === '/api/service-requests/intake-assistant') return jsonResponse(200, intake)
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={me}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr' })
  expect((await screen.findByText('불러오는 중…')).closest('[aria-busy="true"]')).not.toBeNull()
  expect(screen.queryByRole('button', { name: '새 요청' })).not.toBeInTheDocument()
  release()
  expect(await screen.findByRole('button', { name: /요청 x/ })).toBeInTheDocument()
  expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument()
})

it('목록 조회 실패는 경고와 다시 시도를 보이고 재시도 성공 시 목록을 그린다', async () => {
  let calls = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/service-requests?scope=mine') return ++calls === 1 ? jsonResponse(500, { message: '서버 오류' }) : jsonResponse(200, [row('y', 'reviewing')])
    if (url === '/api/service-requests/intake-assistant') return jsonResponse(200, intake)
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={me}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr' })
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('요청 목록을 불러오지 못했습니다')
  expect(alert).toHaveTextContent('서버 오류')
  await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByRole('button', { name: /요청 y/ })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(calls).toBe(2)
})

it('요청이 하나도 없으면 접수 에이전트 카드(이름·설명·예시 칩)와 새 요청만 보이고 플랫폼 문구·집계·필터는 없다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/service-requests/intake-assistant' ? jsonResponse(200, intake) : jsonResponse(200, [])))
  const { container } = renderWithProviders(<TooltipProvider><MeContext value={me}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr' })
  expect(await screen.findByText('접수 도우미')).toBeInTheDocument()
  expect(screen.getByText('요청을 정리합니다')).toBeInTheDocument()
  const examples = screen.getByRole('list', { name: '첫 질문 예시' })
  expect(within(examples).getAllByRole('listitem').map(item => item.textContent)).toEqual(['설비 알람 확인', '리포트 요청'])
  expect(container).not.toHaveTextContent('사용법')
  expect(container).not.toHaveTextContent('첨부 파일을 올리세요')
  expect(screen.getByRole('button', { name: '새 요청' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '진행 중' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '완료' })).not.toBeInTheDocument()
  expect(container).not.toHaveTextContent('SR이 없습니다')
  expect(container).not.toHaveTextContent('요청 내용을 대화로 정리해 접수합니다')
  expect(screen.queryByRole('button', { name: '자료 열기' })).not.toBeInTheDocument()
  expect(container).not.toHaveTextContent('같은 태그 대화')
  await userEvent.click(screen.getByRole('button', { name: '새 요청' }))
  // Composer 제안도 같은 추출 결과만 — 머리글·비인용 줄이 AI로 전송되지 않는다.
  expect(screen.getByRole('button', { name: '설비 알람 확인' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '리포트 요청' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '시작' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '첨부 파일을 올리세요' })).not.toBeInTheDocument()
  expect(container).not.toHaveTextContent('사용법')
  expect(container).not.toHaveTextContent(/\d+건/)
  expect(screen.queryByRole('button', { name: '자료 열기' })).not.toBeInTheDocument()
  expect(container).not.toHaveTextContent('같은 태그 대화')
})

it('에이전트 설명·예시가 비어 있으면 이름만 보이고 플랫폼이 지은 예시는 넣지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/service-requests/intake-assistant' ? jsonResponse(200, { srIntakeAssistantId: 'a', name: '접수 도우미', summary: '', usageExample: '### 사용법\n- 시작\n- 첨부를 올리세요' }) : jsonResponse(200, [])))
  const { container } = renderWithProviders(<TooltipProvider><MeContext value={me}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr' })
  expect(await screen.findByText('접수 도우미')).toBeInTheDocument()
  expect(screen.queryByRole('list', { name: '첫 질문 예시' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '새 요청' }))
  expect(screen.getByRole('textbox', { name: '접수 메시지' })).toBeInTheDocument()
  expect(container).not.toHaveTextContent('설비 알람 원인을 확인하고 싶어요')
  expect(screen.queryByRole('button', { name: '시작' })).not.toBeInTheDocument()
  expect(container).not.toHaveTextContent('사용법')
})

it('필터에 맞는 요청이 없으면 안내와 필터 초기화를 보이고 기본 필터에서는 초기화 버튼을 숨긴다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/service-requests?scope=mine') return jsonResponse(200, [row('z', 'submitted')])
    if (url === '/api/service-requests/intake-assistant') return jsonResponse(200, intake)
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={me}><SrIntakePage /></MeContext></TooltipProvider>, { route: '/sr' })
  await screen.findByRole('button', { name: /요청 z/ })
  expect(screen.queryByText('선택한 상태의 요청이 없습니다.')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '완료' }))
  expect(screen.getByText('선택한 상태의 요청이 없습니다.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /요청 z/ })).not.toBeInTheDocument()
  expect(screen.queryByText('접수 도우미')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
  expect(screen.getByRole('button', { name: /요청 z/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '진행 중' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: '필터 초기화' })).not.toBeInTheDocument()
})
