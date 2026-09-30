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
