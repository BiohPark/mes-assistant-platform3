import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import { MeContext } from '@/app/auth'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { MaterialsPanel } from './MaterialsPanel'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: toastSuccess } }))
afterEach(() => { vi.unstubAllGlobals(); toastSuccess.mockClear() })

it('shows a selected older version, offers an explicit switch, and keeps indirect files out of the pool', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  const old = { id: 'v1', originTaskId: 'source', name: 'report.md', mime: 'text/markdown', size: 3, version: 1, source: 'upload', isOutput: false, uploadedAt: '2026-01-01T00:00:00.000Z' }
  const fresh = { ...old, id: 'v2', version: 2, previousId: 'v1' }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [
      { file: old, sourceTaskId: 'source', sourceCode: 'WK-2026-0002', sourceTitle: '원본 대화', viaTags: ['direct'], role: 'upload', selected: 'main', newerVersionId: 'v2' },
      { file: fresh, sourceTaskId: 'source', sourceCode: 'WK-2026-0002', sourceTitle: '원본 대화', viaTags: ['direct'], role: 'upload', olderVersionIds: ['v1'] },
    ], conversations: [] })
    if (url === '/api/tasks/t/files') return jsonResponse(200, [])
    if (url === '/api/files/v2/versions') return jsonResponse(200, [fresh, old])
    if (url === '/api/tasks/t/inputs/v1/switch-version') return new Response(null, { status: 204 })
    return jsonResponse(200, [])
  }))
  const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['direct'], checklist: [], inputs: [{ fileId: 'v1', weight: 'main', selectedAt: '2026-01-01T00:00:00.000Z', selectedBy: 'u' }], outputFileIds: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-01-01T00:00:00.000Z' } satisfies Task
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><MaterialsPanel task={task} /></MeContext>)
  expect(await screen.findByText('새 버전 있음 · 바꾸기')).toBeInTheDocument()
  expect(screen.getByText(/report.md v1/)).toBeInTheDocument()
  // 출처는 내부 ID가 아니라 대화 코드·제목으로 보인다
  expect(screen.getByTestId('selected-file-v1')).toHaveTextContent('WK-2026-0002 · 원본 대화')
  expect(screen.getByTestId('selected-file-v1')).not.toHaveTextContent('source')
  fireEvent.click(screen.getByText('새 버전 있음 · 바꾸기'))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t/inputs/v1/switch-version' && init?.method === 'POST')).toBe(true))
  fireEvent.click(screen.getByRole('tab', { name: '공유 자료함' }))
  expect(screen.getByText(/report.md v2/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'WK-2026-0002' })).toHaveAttribute('href', '/c/source')
  expect(screen.getByTestId('candidate-file-v2')).toHaveTextContent('업로드 · WK-2026-0002 · 원본 대화 · direct')
  expect(screen.getByTestId('candidate-file-v2')).not.toHaveTextContent(/·\s*source/)
  fireEvent.click(screen.getByRole('button', { name: '이전 버전 1' }))
  expect(await screen.findByText('report.md v1')).toBeInTheDocument()
})

it('shows directly shared conversations and selects the full snapshot without requesting a summary', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [{ taskId: 'source', code: 'WK-2026-0002', title: '원본',
      status: 'done', assistant: { id: 'a', name: '도우미', color: '#123456' }, sharedTags: ['direct'], messageCount: 2, bytes: 14, lastActivityAt: '2026-01-01T00:00:00.000Z' }] })
    if (url === '/api/tasks/t/files' || url === '/api/tasks/t/conversation-inputs') return jsonResponse(200, [])
    if (url === '/api/tasks/t/conversation-inputs/source' && init?.method === 'PUT') return jsonResponse(200, { input: { mode: 'full' } })
    return jsonResponse(200, [])
  }))
  const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['direct'], checklist: [], inputs: [], outputFileIds: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-01-01T00:00:00.000Z' } satisfies Task
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><MaterialsPanel task={task} /></MeContext>)
  fireEvent.click(screen.getByRole('tab', { name: '대화' }))
  expect(await screen.findByTestId('conversation-source')).toHaveTextContent('WK-2026-0002 · 원본')
  fireEvent.click(screen.getByLabelText('WK-2026-0002 참고 입력으로 선택'))
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
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><MaterialsPanel task={task} /></MeContext>)
  fireEvent.click(screen.getByRole('tab', { name: '공유 자료함' }))
  await screen.findByTestId('candidate-file-z')
  await waitFor(() => expect(screen.getByTestId('materials-shared').textContent).toMatch(/에이전트 1.*a\.txt.*b\.txt.*에이전트 2.*z\.txt/s))
})

const baseTask = { id: 't', code: 'WK-1', assistantId: 'a1', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['shared'], checklist: [], inputs: [], outputFileIds: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-01-01T00:00:00.000Z' } satisfies Task
const me = { id: 'u', name: '사용자', role: '', roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }
const fileMeta = { id: 'out', originTaskId: 'source', name: 'result.md', mime: 'text/markdown', size: 4, version: 1, source: 'assistant', isOutput: true, uploadedAt: '2026-01-01T00:00:00.000Z' }

it('shows loading, no-results with a clear button, and the inputs caption on the shared tab', async () => {
  let release!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/tasks/t/candidates') return new Promise<Response>((resolve) => { release = resolve })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<MeContext value={me}><MaterialsPanel task={baseTask} /></MeContext>)
  fireEvent.click(screen.getByRole('tab', { name: '공유 자료함' }))
  const shared = screen.getByTestId('materials-shared')
  expect(shared).toHaveTextContent('불러오는 중…')
  expect(shared).not.toHaveTextContent('같은 태그 대화의 파일이 없습니다.')
  expect(shared).toHaveTextContent('선택한 파일만 AI 입력에 남습니다.')
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
  fireEvent.click(screen.getByRole('tab', { name: '공유 자료함' }))
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
  fireEvent.click(screen.getByRole('tab', { name: '공유 자료함' }))
  const row = await screen.findByTestId('candidate-file-out')
  expect(within(row).getByRole('checkbox')).toBeEnabled()
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
  expect(within(shared).queryByRole('checkbox')).not.toBeInTheDocument()
  expect(shared).not.toHaveTextContent('불러오는 중…')
  fireEvent.change(screen.getByLabelText('공유 자료함 검색'), { target: { value: 'missing' } })
  expect(shared).not.toHaveTextContent('"missing"에 맞는 파일이 없습니다.')
  fireEvent.change(screen.getByLabelText('공유 자료함 검색'), { target: { value: '' } })
  expect(shared).not.toHaveTextContent('같은 태그 대화의 파일이 없습니다.')

  forbidden = false
  fireEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
  expect(within(await screen.findByTestId('candidate-file-out')).getByRole('checkbox')).toBeEnabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('shows the shared empty state only after a successful request with no candidates', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/tasks/t/candidates' ? jsonResponse(200, { files: [], conversations: [] }) : jsonResponse(200, [])))
  renderWithProviders(<MeContext value={me}><MaterialsPanel task={baseTask} /></MeContext>)
  fireEvent.click(screen.getByRole('tab', { name: '공유 자료함' }))
  expect(await screen.findByText('같은 태그 대화의 파일이 없습니다.')).toBeInTheDocument()
  expect(screen.getByTestId('materials-shared')).not.toHaveTextContent('불러오는 중…')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('keeps a selected input whose metadata is unavailable as a row without a toggle', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/tasks/t/candidates' ? jsonResponse(200, { files: [], conversations: [] }) : jsonResponse(200, [])))
  const task = { ...baseTask, inputs: [{ fileId: 'ghost', weight: 'reference' as const, selectedAt: '2026-01-01T00:00:00.000Z', selectedBy: 'u' }] }
  renderWithProviders(<MeContext value={me}><MaterialsPanel task={task} /></MeContext>)
  const row = await screen.findByTestId('selected-file-ghost')
  expect(row).toHaveTextContent('파일 정보를 확인할 수 없습니다. 선택은 유지됩니다.')
  expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument()
  expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  expect(screen.queryByText('선택한 파일이 없습니다.')).not.toBeInTheDocument()
})

it('tells the uploader where the file becomes visible and shows the inputs caption on the own tab', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/files' && init?.method === 'POST') return jsonResponse(201, { ...fileMeta, id: 'new', originTaskId: 't' })
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [] })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<MeContext value={me}><MaterialsPanel task={baseTask} /></MeContext>)
  fireEvent.click(screen.getByRole('tab', { name: '이 대화 파일' }))
  const own = screen.getByTestId('materials-own')
  expect(own).toHaveTextContent('선택한 파일만 AI 입력에 남습니다.')
  const input = own.querySelector('input[type="file"]')!
  fireEvent.change(input, { target: { files: [new File(['x'], 'memo.txt', { type: 'text/plain' })] } })
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('1개 파일을 업로드했습니다.', { description: '같은 태그 대화에서 자료 후보로 보입니다.' }))
})
