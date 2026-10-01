import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import { MeContext } from '@/app/auth'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { MaterialsPanel } from './MaterialsPanel'

afterEach(() => vi.unstubAllGlobals())

it('shows a selected older version, offers an explicit switch, and keeps indirect files out of the pool', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  const old = { id: 'v1', originTaskId: 'source', name: 'report.md', mime: 'text/markdown', size: 3, version: 1, source: 'upload', isOutput: false, uploadedAt: '2026-01-01T00:00:00.000Z' }
  const fresh = { ...old, id: 'v2', version: 2, previousId: 'v1' }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [
      { file: old, sourceTaskId: 'source', viaTags: ['direct'], role: 'upload', selected: 'main', newerVersionId: 'v2' },
      { file: fresh, sourceTaskId: 'source', viaTags: ['direct'], role: 'upload', olderVersionIds: ['v1'] },
    ], conversations: [] })
    if (url === '/api/tasks/t/files') return jsonResponse(200, [])
    if (url === '/api/files/v2/versions') return jsonResponse(200, [fresh, old])
    if (url === '/api/tasks/t/inputs/v1/switch-version') return new Response(null, { status: 204 })
    return jsonResponse(200, [])
  }))
  const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['direct'], checklist: [], inputs: [{ fileId: 'v1', weight: 'main', selectedAt: '2026-01-01T00:00:00.000Z', selectedBy: 'u' }], outputFileIds: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-01-01T00:00:00.000Z' } satisfies Task
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><MaterialsPanel task={task} /></MeContext>)
  expect(await screen.findByText('새 버전 있음 · 바꾸기')).toBeInTheDocument()
  expect(screen.getByText(/report.md v1/)).toBeInTheDocument()
  fireEvent.click(screen.getByText('새 버전 있음 · 바꾸기'))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t/inputs/v1/switch-version' && init?.method === 'POST')).toBe(true))
  fireEvent.click(screen.getByRole('tab', { name: '공유 자료함' }))
  expect(screen.getByText(/report.md v2/)).toBeInTheDocument()
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
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><MaterialsPanel task={task} /></MeContext>)
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
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><MaterialsPanel task={task} /></MeContext>)
  fireEvent.click(screen.getByRole('tab', { name: '공유 자료함' }))
  await screen.findByTestId('candidate-file-z')
  await waitFor(() => expect(screen.getByTestId('materials-shared').textContent).toMatch(/에이전트 1.*a\.txt.*b\.txt.*에이전트 2.*z\.txt/s))
})
