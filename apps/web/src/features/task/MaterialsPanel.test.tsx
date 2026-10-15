import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import type { Task } from '@mes/domain'
import { MeContext } from '@/app/auth'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { MaterialsPanel } from './MaterialsPanel'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: toastSuccess, warning: vi.fn() } }))
afterEach(() => { vi.unstubAllGlobals(); toastSuccess.mockClear() })
// 실시간 이벤트(sr.updated) 구독을 테스트에서 직접 흘려 넣는다
const liveListeners = vi.hoisted(() => new Set<(event: { event: string; data: Record<string, unknown> }) => void>())
vi.mock('@/app/useEvents', async (original) => ({ ...await original<typeof import('@/app/useEvents')>(),
  subscribeEvent: (listener: (event: { event: string; data: Record<string, unknown> }) => void) => { liveListeners.add(listener); return () => { liveListeners.delete(listener) } } }))

it('S13: 연결된 SR 첨부 구역 — 같은 파일을 보이고 미리보기·내려받기·선택 해제를 하며 SR 변경을 실시간 반영한다', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  const srFile = { id: 'sf', originSrId: 'sr1', name: 'spec.txt', mime: 'text/plain', size: 4, sha256: 'x', version: 1, source: 'upload', isOutput: false, uploadedBy: 'r', uploadedAt: '2026-01-01T00:00:00.000Z' }
  let srFiles: Array<Record<string, unknown>> = [{ file: srFile, srId: 'sr1', srCode: 'SR-2026-0001', srTitle: '알람', selected: 'reference' }]
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], srFiles, conversations: [] })
    if (url === '/api/files/sf/content') return new Response('본문', { status: 200 })
    if (url === '/api/files/sf2/content') return new Response('추가', { status: 200 })
    if (url === '/api/tasks/t/inputs/sf') return new Response(null, { status: 204 })
    return jsonResponse(200, [])
  }))
  vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  onTestFinished(() => anchorClick.mockRestore())
  const task = { ...baseTask, id: 't', tags: ['SR-2026-0001'], inputs: [{ fileId: 'sf', weight: 'reference' as const, selectedAt: '2026-01-01T00:00:00.000Z', selectedBy: 'u' }] } satisfies Task
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><MaterialsPanel task={task} /></MeContext>)
  const section = await screen.findByTestId('materials-sr-files')
  expect(section).toHaveTextContent('연결된 SR 첨부')
  expect(section).toHaveTextContent('SR-2026-0001')
  expect(within(section).getByTestId('sr-file-sf')).toHaveTextContent('spec.txt v1')
  // 첨부 중인 SR 파일은 '첨부됨'으로 보인다
  expect(within(section).getByRole('button', { name: 'spec.txt 첨부' })).toHaveAttribute('aria-pressed', 'true')
  // 내려받기
  fireEvent.click(within(section).getByRole('button', { name: '다운로드' }))
  await waitFor(() => expect(calls.some(([url]) => url === '/api/files/sf/content')).toBe(true))
  // 미리보기
  fireEvent.click(within(section).getByRole('button', { name: 'spec.txt v1' }))
  expect(await screen.findByText('본문')).toBeInTheDocument()
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  // '첨부됨'을 다시 누르면 첨부에서 뺀다(같은 setInput 경로)
  fireEvent.click(within(section).getByRole('button', { name: 'spec.txt 첨부' }))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t/inputs/sf' && init?.method === 'DELETE')).toBe(true))
  // SR이 바뀌면(sr.updated) 다시 읽는다
  srFiles = [...srFiles, { file: { ...srFile, id: 'sf2', name: 'more.txt' }, srId: 'sr1', srCode: 'SR-2026-0001', srTitle: '알람' }]
  act(() => { for (const listener of liveListeners) listener({ event: 'sr.updated', data: { srId: 'sr1' } }) })
  expect(await screen.findByTestId('sr-file-sf2')).toHaveTextContent('more.txt v1')
})

it('S13: 연결 SR 첨부가 없으면 구역을 그리지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/tasks/t/candidates' ? jsonResponse(200, { files: [], srFiles: [], conversations: [] }) : jsonResponse(200, [])))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><MaterialsPanel task={baseTask} /></MeContext>)
  expect(await screen.findByText('같은 태그 대화의 파일이 없습니다.')).toBeInTheDocument()
  expect(screen.queryByTestId('materials-sr-files')).not.toBeInTheDocument()
})

it('shows a selected older version, offers an explicit switch, and keeps indirect files out of the pool', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  const old = { id: 'v1', originTaskId: 'source', name: 'report.md', mime: 'text/markdown', size: 3, version: 1, source: 'upload', isOutput: false, uploadedAt: '2026-01-01T00:00:00.000Z' }
  const fresh = { ...old, id: 'v2', version: 2, previousId: 'v1' }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [
      { file: old, sourceTaskId: 'source', sourceCode: 'WK-2026-0002', sourceTitle: '원본 대화', viaTags: ['direct'], role: 'upload', email: null, emailIsDefault: false, selected: 'main', newerVersionId: 'v2' },
      { file: fresh, sourceTaskId: 'source', sourceCode: 'WK-2026-0002', sourceTitle: '원본 대화', viaTags: ['direct'], role: 'upload', email: null, emailIsDefault: false, olderVersionIds: ['v1'] },
    ], conversations: [] })
    if (url === '/api/tasks/t/files') return jsonResponse(200, [])
    if (url === '/api/files/v2/versions') return jsonResponse(200, [fresh, old])
    if (url === '/api/tasks/t/inputs/v1/switch-version') return new Response(null, { status: 204 })
    return jsonResponse(200, [])
  }))
  const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['direct'], checklist: [], inputs: [{ fileId: 'v1', weight: 'main', selectedAt: '2026-01-01T00:00:00.000Z', selectedBy: 'u' }], outputFileIds: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-01-01T00:00:00.000Z' } satisfies Task
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><MaterialsPanel task={task} /></MeContext>)
  // 첨부 중인 이전 버전은 자료함에 남아 '첨부됨'과 새 버전 전환을 보인다
  const staged = await screen.findByTestId('candidate-file-v1')
  expect(within(staged).getByRole('button', { name: 'report.md 첨부' })).toHaveAttribute('aria-pressed', 'true')
  // 출처는 내부 ID가 아니라 대화 코드·제목으로 보인다
  expect(staged).toHaveTextContent('WK-2026-0002 · 원본 대화')
  expect(staged).not.toHaveTextContent(/·\s*source/)
  fireEvent.click(within(staged).getByText('새 버전 있음 · 바꾸기'))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t/inputs/v1/switch-version' && init?.method === 'POST')).toBe(true))
  const latest = screen.getByTestId('candidate-file-v2')
  expect(latest).toHaveTextContent('report.md v2')
  expect(within(latest).queryByText('새 버전 있음 · 바꾸기')).not.toBeInTheDocument()
  expect(within(latest).getByRole('link', { name: 'WK-2026-0002' })).toHaveAttribute('href', '/c/source')
  expect(latest).toHaveTextContent('업로드 · WK-2026-0002 · 원본 대화 · direct')
  expect(latest).not.toHaveTextContent(/·\s*source/)
  fireEvent.click(within(latest).getByRole('button', { name: '이전 버전 1' }))
  expect(await within(latest).findByText('report.md v1')).toBeInTheDocument()
})

it('previews directly shared conversations before staging and shows count, recency and usage', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [{ taskId: 'source', code: 'WK-2026-0002', title: '원본',
      status: 'done', assistant: { id: 'a', name: '도우미', color: '#123456' }, sharedTags: ['direct'], messageCount: 2, bytes: 14, lastActivityAt: '2026-01-01T00:00:00.000Z', used: true }] })
    if (url === '/api/tasks/t/files' || url === '/api/tasks/t/conversation-inputs') return jsonResponse(200, [])
    if (url === '/api/tasks/source') return jsonResponse(200, { ...baseTask, id: 'source', threadId: 'source-thread' })
    if (url === '/api/threads/source-thread/messages') return jsonResponse(200, [{ id: 'm', role: 'user', content: '미리 볼 원문', status: 'done', createdAt: '2026-01-01' }])
    if (url === '/api/tasks/t/conversation-inputs/source' && init?.method === 'PUT') return jsonResponse(200, { input: { mode: 'full' } })
    return jsonResponse(200, [])
  }))
  const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['direct'], checklist: [], inputs: [], outputFileIds: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-01-01T00:00:00.000Z' } satisfies Task
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><MaterialsPanel task={task} /></MeContext>)
  expect(await screen.findByTestId('conversation-source')).toHaveTextContent('WK-2026-0002 · 원본')
  expect(screen.getByText('같은 태그 대화 1개')).toBeInTheDocument()
  expect(screen.getByTestId('conversation-source')).toHaveTextContent('사용됨')
  // 상태 원문(done)이 아니라 라벨로 보인다
  expect(screen.getByTestId('conversation-source')).toHaveTextContent('완료')
  expect(screen.getByTestId('conversation-source')).not.toHaveTextContent(/\bdone\b/)
  expect(screen.getByTestId('conversation-source').querySelector('time')).toHaveAttribute('datetime', '2026-01-01T00:00:00.000Z')
  expect(screen.getByTestId('conversation-candidates').parentElement).toHaveAttribute('data-tour', 'materials-conversations')
  const attach = screen.getByRole('button', { name: 'WK-2026-0002 첨부' })
  expect(attach).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(attach)
  expect(await screen.findByText('미리 볼 원문')).toBeInTheDocument()
  expect(calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '적용' }))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t/conversation-inputs/source' && init?.method === 'PUT' && JSON.parse(String(init.body)).mode === 'full')).toBe(true))
  expect(calls.some(([url]) => url.includes('summary-draft'))).toBe(false)
})

it('groups shared files by assistant order and sorts names within each group', async () => {
  const base = { id: 'f', originTaskId: 'source', name: 'z.txt', mime: 'text/plain', size: 1, version: 1, source: 'upload', isOutput: false, uploadedAt: '2026-01-01T00:00:00.000Z' }
  const candidate = (id: string, name: string, sourceAssistantId: string) => ({ file: { ...base, id, name }, sourceTaskId: `source-${id}`, sourceAssistantId, viaTags: ['shared'], role: 'upload' })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/assistants') return jsonResponse(200, [2, 1].map((order) => ({ id: `a${order}`, name: `에이전트 ${order}`, level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 0 })))
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [candidate('z', 'z.txt', 'a2'), candidate('b', 'b.txt', 'a1'), candidate('a', 'a.txt', 'a1')], conversations: [] })
    return jsonResponse(200, [])
  }))
  const task = { id: 't', code: 'WK-1', assistantId: 'a1', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['shared'], checklist: [], inputs: [], outputFileIds: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-01-01T00:00:00.000Z' } satisfies Task
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><MaterialsPanel task={task} /></MeContext>)
  await screen.findByTestId('candidate-file-z')
  await waitFor(() => expect(screen.getByTestId('materials-shared').textContent).toMatch(/에이전트 1.*a\.txt.*b\.txt.*에이전트 2.*z\.txt/s))
})

const baseTask = { id: 't', code: 'WK-1', assistantId: 'a1', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['shared'], checklist: [], inputs: [], outputFileIds: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-01-01T00:00:00.000Z' } satisfies Task
const me = { id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }
const fileMeta = { id: 'out', originTaskId: 'source', name: 'result.md', mime: 'text/markdown', size: 4, version: 1, source: 'assistant', isOutput: true, uploadedAt: '2026-01-01T00:00:00.000Z' }

it('shows loading, no-results with a clear button, and the library caption in the shared section', async () => {
  let release!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/tasks/t/candidates') return new Promise<Response>((resolve) => { release = resolve })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<MeContext value={me}><MaterialsPanel task={baseTask} /></MeContext>)
  const shared = screen.getByTestId('materials-shared')
  expect(shared).toHaveTextContent('불러오는 중…')
  expect(shared).not.toHaveTextContent('같은 태그 대화의 파일이 없습니다.')
  // 긴 설명은 화면 대신 툴팁(도움말 아이콘)에 둔다
  expect(within(screen.getByTestId('materials-library')).getByRole('button', { name: /^\[첨부\]를 누르면/ })).toBeInTheDocument()
  expect(screen.getByTestId('materials-library')).not.toHaveTextContent('다음 질문에 한 번만')
  release(jsonResponse(200, { files: [{ file: fileMeta, sourceTaskId: 'source', sourceCode: 'WK-2', sourceTitle: '원본', viaTags: ['shared'], role: 'output' }], conversations: [] }))
  await screen.findByTestId('candidate-file-out')
  expect(shared).not.toHaveTextContent('불러오는 중…')
  // 산출물 배지는 행 텍스트 순서를 유지한 채 토큰 색으로 보인다
  expect(screen.getByTestId('candidate-file-out')).toHaveTextContent('산출물 · WK-2 · 원본 · shared')
  expect(screen.getByText('산출물')).toHaveClass('bg-tone-violet-bg', 'text-tone-violet-fg')
  fireEvent.change(screen.getByLabelText('공유 자료함 검색'), { target: { value: 'zzz' } })
  expect(shared).toHaveTextContent('"zzz"에 맞는 파일이 없습니다.')
  expect(shared).not.toHaveTextContent('같은 태그 대화의 파일이 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '검색 지우기' }))
  expect(screen.getByLabelText('공유 자료함 검색')).toHaveValue('')
  expect(screen.getByTestId('candidate-file-out')).toBeInTheDocument()
  expect(screen.getByTestId('materials-shared').innerHTML).not.toMatch(/(?:bg|text|border|fill)-(?:amber|violet|sky)-\d/)
})

it('keeps the shared tab silent about empty results while the candidate request has failed', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/tasks/t/candidates' ? jsonResponse(500, { message: 'boom' }) : jsonResponse(200, [])))
  renderWithProviders(<MeContext value={me}><MaterialsPanel task={baseTask} /></MeContext>)
  expect(await screen.findByRole('alert')).toHaveTextContent('자료를 불러오지 못했습니다.')
  expect(screen.getByTestId('materials-shared')).not.toHaveTextContent('같은 태그 대화의 파일이 없습니다.')
  expect(screen.getByTestId('materials-shared')).not.toHaveTextContent('불러오는 중…')
})

it('hides cached shared candidates and their toggles after a 403 refetch until retry succeeds', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const data = { files: [{ file: fileMeta, sourceTaskId: 'source', sourceAssistantId: 'a1', viaTags: ['shared'], role: 'output' }], conversations: [] }
  let forbidden = false
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/tasks/t/candidates') return forbidden ? jsonResponse(403, { message: 'Forbidden' }) : jsonResponse(200, data)
    return jsonResponse(200, [])
  }))
  renderWithProviders(<QueryClientProvider client={client}><MeContext value={me}><MaterialsPanel task={baseTask} /></MeContext></QueryClientProvider>)
  const row = await screen.findByTestId('candidate-file-out')
  expect(within(row).getByRole('button', { name: 'result.md 첨부' })).toBeEnabled()
  fireEvent.change(screen.getByLabelText('공유 자료함 검색'), { target: { value: 'result' } })

  forbidden = true
  await act(async () => { await client.refetchQueries({ queryKey: ['candidates', 't'] }) })
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('자료를 불러오지 못했습니다.')
  // React Query retains the previous data; the error state must hide it.
  expect(client.getQueryData(['candidates', 't'])).toEqual(data)
  expect(screen.queryByTestId('candidate-file-out')).not.toBeInTheDocument()
  expect(screen.queryByTestId('shared-group-a1')).not.toBeInTheDocument()
  const shared = screen.getByTestId('materials-shared')
  expect(within(shared).queryByRole('button', { name: 'result.md 첨부' })).not.toBeInTheDocument()
  expect(shared).not.toHaveTextContent('불러오는 중…')
  fireEvent.change(screen.getByLabelText('공유 자료함 검색'), { target: { value: 'missing' } })
  expect(shared).not.toHaveTextContent('"missing"에 맞는 파일이 없습니다.')
  fireEvent.change(screen.getByLabelText('공유 자료함 검색'), { target: { value: '' } })
  expect(shared).not.toHaveTextContent('같은 태그 대화의 파일이 없습니다.')

  forbidden = false
  fireEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
  expect(within(await screen.findByTestId('candidate-file-out')).getByRole('button', { name: 'result.md 첨부' })).toBeEnabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('shows the shared empty state only after a successful request with no candidates', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/tasks/t/candidates' ? jsonResponse(200, { files: [], conversations: [] }) : jsonResponse(200, [])))
  renderWithProviders(<MeContext value={me}><MaterialsPanel task={baseTask} /></MeContext>)
  expect(await screen.findByText('같은 태그 대화의 파일이 없습니다.')).toBeInTheDocument()
  expect(screen.getByTestId('materials-shared')).not.toHaveTextContent('불러오는 중…')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('tells the uploader where the file becomes visible from the this-conversation section', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/files' && init?.method === 'POST') return jsonResponse(201, { ...fileMeta, id: 'new', originTaskId: 't' })
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [] })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<MeContext value={me}><MaterialsPanel task={baseTask} /></MeContext>)
  const own = screen.getByTestId('materials-own')
  expect(own).toHaveTextContent('이 대화')
  const input = own.querySelector('input[type="file"]')!
  fireEvent.change(input, { target: { files: [new File(['x'], 'memo.txt', { type: 'text/plain' })] } })
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('1개 파일을 업로드했습니다.', { description: '같은 태그 대화에서 자료 후보로 보입니다.' }))
})

it('S14: 자료 패널은 자료함만 — [첨부]로 붙이고 다시 눌러 빼며, 사용됨을 작게 표시하고 내 파일만 삭제한다', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  const mine = { ...fileMeta, id: 'mine', originTaskId: 't', name: 'mine.txt', source: 'upload', isOutput: false, uploadedBy: 'u' }
  const theirs = { ...fileMeta, id: 'theirs', originTaskId: 't', name: 'theirs.txt', source: 'upload', isOutput: false, uploadedBy: 'other' }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [], usedFileIds: ['mine'] })
    if (url === '/api/tasks/t/files') return jsonResponse(200, [mine, theirs])
    if (url.startsWith('/api/tasks/t/inputs/')) return new Response(null, { status: 204 })
    return jsonResponse(200, [])
  }))
  const task = { ...baseTask, inputs: [{ fileId: 'theirs', weight: 'reference' as const, selectedAt: '2026-01-01T00:00:00.000Z', selectedBy: 'u' }] }
  renderWithProviders(<MeContext value={me}><MaterialsPanel task={task} /></MeContext>)
  const library = screen.getByTestId('materials-library')
  expect(library).toHaveAttribute('data-tour', 'materials-library')
  // 아래 '다음 질문에 보낼 자료' 구역은 없다 — 첨부는 입력창 칩으로만 보인다
  expect(screen.queryByTestId('materials-staged')).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent('다음 질문에 보낼 자료')
  expect(document.body).not.toHaveTextContent('담기')
  // 사용됨은 요청 기록(usedFileIds) 기준
  expect(await within(library).findByTestId('used-mine')).toHaveTextContent('사용됨')
  expect(within(library).queryByTestId('used-theirs')).not.toBeInTheDocument()
  // 내 파일만 삭제 버튼
  expect(within(screen.getByTestId('file-mine')).getByRole('button', { name: '삭제' })).toBeInTheDocument()
  expect(within(screen.getByTestId('file-theirs')).queryByRole('button', { name: '삭제' })).not.toBeInTheDocument()
  // [첨부] = 담기, '첨부됨' 다시 누르기 = 빼기 (같은 setInput 경로). 자료함에는 ★가 없다
  expect(within(library).queryByRole('button', { name: /주 입력/ })).not.toBeInTheDocument()
  fireEvent.click(within(library).getByRole('button', { name: 'mine.txt 첨부' }))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t/inputs/mine' && init?.method === 'PUT' && JSON.parse(String(init.body)).weight === 'reference')).toBe(true))
  const attached = within(library).getByRole('button', { name: 'theirs.txt 첨부' })
  expect(attached).toHaveAttribute('aria-pressed', 'true')
  expect(attached).toHaveTextContent('첨부됨')
  fireEvent.click(attached)
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t/inputs/theirs' && init?.method === 'DELETE')).toBe(true))
})

it('S14: 연결된 SR 본문을 자료함 항목으로 보이고 [첨부]·빼기를 하며, 요청 시작(input.updated)에 다시 읽고, 목록을 못 읽으면 구역만 숨긴다', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  let srInputs: Response | null = null
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [] })
    if (url === '/api/tasks/t/sr-inputs') return srInputs ?? jsonResponse(200, [
      { srId: 'sr1', code: 'SR-2026-0001', title: '알람 필터', bytes: 120, selected: false, used: true },
      { srId: 'sr2', code: 'SR-2026-0002', title: '리포트', bytes: 80, selected: true, used: false },
    ])
    if (url.startsWith('/api/tasks/t/sr-inputs/')) return new Response(null, { status: 204 })
    return jsonResponse(200, [])
  }))
  const view = renderWithProviders(<MeContext value={me}><MaterialsPanel task={baseTask} /></MeContext>)
  const section = await screen.findByTestId('materials-sr-bodies')
  expect(section).toHaveTextContent('연결된 SR 본문')
  expect(within(section).getByTestId('sr-body-sr1')).toHaveTextContent('SR-2026-0001 · 알람 필터')
  expect(within(section).getByTestId('sr-body-sr1')).toHaveTextContent('사용됨')
  fireEvent.click(within(section).getByRole('button', { name: 'SR-2026-0001 첨부' }))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t/sr-inputs/sr1' && init?.method === 'PUT')).toBe(true))
  const attached = within(section).getByRole('button', { name: 'SR-2026-0002 첨부' })
  expect(attached).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(attached)
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t/sr-inputs/sr2' && init?.method === 'DELETE')).toBe(true))
  // 서버가 요청 시작 때 SR 본문 첨부를 비우면 input.updated — 첨부됨·사용됨을 다시 읽는다
  const reads = () => calls.filter(([url, init]) => url === '/api/tasks/t/sr-inputs' && (init?.method ?? 'GET') === 'GET').length
  const before = reads()
  act(() => { for (const listener of liveListeners) listener({ event: 'input.updated', data: { taskId: 't' } }) })
  await waitFor(() => expect(reads()).toBeGreaterThan(before))
  view.unmount()
  srInputs = jsonResponse(404, { message: 'Not Found' })
  renderWithProviders(<MeContext value={me}><MaterialsPanel task={baseTask} /></MeContext>)
  await screen.findByText('같은 태그 대화의 파일이 없습니다.')
  await waitFor(() => expect(calls.filter(([url, init]) => url === '/api/tasks/t/sr-inputs' && (init?.method ?? 'GET') === 'GET').length).toBeGreaterThan(before + 1))
  expect(screen.queryByTestId('materials-sr-bodies')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('S14: 같은 태그 대화가 없으면 대화도 첨부할 수 있다고 짧게 알린다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/tasks/t/candidates' ? jsonResponse(200, { files: [], conversations: [] }) : jsonResponse(200, [])))
  renderWithProviders(<MeContext value={me}><MaterialsPanel task={baseTask} /></MeContext>)
  expect(await within(screen.getByTestId('conversation-candidates')).findByText('같은 태그 대화가 없습니다. 태그를 같이 쓰는 대화도 파일처럼 첨부할 수 있어요.')).toBeInTheDocument()
})

it('uploads a file dropped on the this-conversation section through the regular upload request', async () => {
  const uploads: FormData[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/files' && init?.method === 'POST') { uploads.push(init.body as FormData); return jsonResponse(201, { ...fileMeta, id: 'new', originTaskId: 't' }) }
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [] })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<MeContext value={me}><MaterialsPanel task={baseTask} /></MeContext>)
  const own = screen.getByTestId('materials-own')
  const file = new File(['x'], 'dropped.txt', { type: 'text/plain' })
  const drag = { dataTransfer: { types: ['Files'], files: [file], items: [] } }
  fireEvent.dragEnter(own, drag)
  expect(screen.getByText('놓으면 이 대화 파일로 저장')).toHaveAttribute('aria-hidden', 'true')
  fireEvent.drop(own, drag)
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('1개 파일을 업로드했습니다.', { description: '같은 태그 대화에서 자료 후보로 보입니다.' }))
  expect(uploads).toHaveLength(1)
  expect(uploads[0]!.get('originTaskId')).toBe('t')
  expect((uploads[0]!.get('file') as File).name).toBe('dropped.txt')
  expect(screen.queryByText('놓으면 이 대화 파일로 저장')).not.toBeInTheDocument()
})

it('ignores drops on the this-conversation section of a completed conversation', () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/tasks/t/candidates' ? jsonResponse(200, { files: [], conversations: [] }) : jsonResponse(200, [])))
  renderWithProviders(<MeContext value={me}><MaterialsPanel task={{ ...baseTask, status: 'done' }} /></MeContext>)
  fireEvent.dragEnter(screen.getByTestId('materials-own'), { dataTransfer: { types: ['Files'], files: [], items: [] } })
  expect(screen.queryByText('놓으면 이 대화 파일로 저장')).not.toBeInTheDocument()
})

it('S14: 이 대화 파일의 이전 버전을 첨부 중이면 그 행에서 새 버전으로 바꾼다', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  const v1 = { ...fileMeta, id: 'own1', originTaskId: 't', name: 'note.txt', source: 'upload', isOutput: false, uploadedBy: 'u', version: 1 }
  const v2 = { ...v1, id: 'own2', version: 2, previousId: 'own1' }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [{ file: v1, sourceTaskId: 't', viaTags: [], role: 'upload', newerVersionId: 'own2' }, { file: v2, sourceTaskId: 't', viaTags: [], role: 'upload' }], conversations: [] })
    if (url === '/api/tasks/t/files') return jsonResponse(200, [v2, v1])
    if (url === '/api/tasks/t/inputs/own1/switch-version') return new Response(null, { status: 204 })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<MeContext value={me}><MaterialsPanel task={{ ...baseTask, inputs: [{ fileId: 'own1', weight: 'reference', selectedAt: '2026-01-01T00:00:00.000Z', selectedBy: 'u' }] }} /></MeContext>)
  const row = await screen.findByTestId('file-own1')
  fireEvent.click(await within(row).findByRole('button', { name: '새 버전 있음 · 바꾸기' }))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t/inputs/own1/switch-version' && init?.method === 'POST')).toBe(true))
  expect(within(screen.getByTestId('file-own2')).queryByRole('button', { name: '새 버전 있음 · 바꾸기' })).not.toBeInTheDocument()
})
