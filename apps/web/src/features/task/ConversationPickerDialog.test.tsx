import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ConversationCandidate } from '@/api/files'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { ConversationPickerDialog } from './ConversationPickerDialog'

const candidate = { taskId: 'source', code: 'WK-2026-0002', title: '원본', status: 'done',
  assistant: { id: 'a', name: '도우미', color: '#123456' }, sharedTags: ['direct'], messageCount: 2, bytes: 12,
  lastActivityAt: '2026-01-01T00:00:00.000Z' } satisfies ConversationCandidate
const messages = ['first', 'second'].map((content, index) => ({ id: `m${index + 1}`, threadId: 'h', seq: index + 1,
  role: index ? 'assistant' : 'user', content, status: 'done', createdAt: '2026-01-01T00:00:00.000Z', attachmentIds: [] }))

afterEach(() => vi.unstubAllGlobals())

function renderPicker(calls: Array<[string, RequestInit | undefined]>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/tasks/source') return jsonResponse(200, { threadId: 'h' })
    if (url === '/api/threads/h/messages') return jsonResponse(200, messages)
    if (url.endsWith('/summary-draft')) return jsonResponse(201, { text: 'generated', source: 'rule' })
    if (url === '/api/tasks/t/conversation-inputs/source' && init?.method === 'PUT') return jsonResponse(200, {})
    return jsonResponse(200, [])
  }))
  renderWithProviders(<ConversationPickerDialog taskId="t" candidate={candidate} onClose={() => {}} />)
}

it('keeps the draft source IDs when the selection changes before applying', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  renderPicker(calls)
  await waitFor(() => expect(calls.some(([url]) => url === '/api/threads/h/messages')).toBe(true))
  fireEvent.click(screen.getByRole('tab', { name: '메시지 선택' }))
  await screen.findByRole('checkbox', { name: '2번째 메시지 선택' })
  fireEvent.click(screen.getByRole('tab', { name: '요약' }))
  fireEvent.click(await screen.findByRole('button', { name: '요약 만들기' }))
  await screen.findByDisplayValue('generated')
  fireEvent.click(screen.getByRole('tab', { name: '메시지 선택' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '2번째 메시지 선택' }))
  fireEvent.click(screen.getByRole('tab', { name: '요약' }))
  fireEvent.click(screen.getByRole('button', { name: '적용' }))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t/conversation-inputs/source' && init?.method === 'PUT')).toBe(true))
  expect(JSON.parse(String(calls.find(([url]) => url.endsWith('/summary-draft'))![1]?.body)).messageIds).toEqual(['m1', 'm2'])
  const body = JSON.parse(String(calls.find(([url, init]) => url === '/api/tasks/t/conversation-inputs/source' && init?.method === 'PUT')![1]?.body))
  expect(body.summary.messageIds).toEqual(['m1', 'm2'])
})

it('uses the current selection for a manually written summary', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  renderPicker(calls)
  await screen.findByRole('tab', { name: '메시지 선택' })
  fireEvent.click(screen.getByRole('tab', { name: '메시지 선택' }))
  await screen.findByRole('checkbox', { name: '2번째 메시지 선택' })
  fireEvent.click(screen.getByRole('checkbox', { name: '2번째 메시지 선택' }))
  fireEvent.click(screen.getByRole('tab', { name: '요약' }))
  fireEvent.change(screen.getByRole('textbox', { name: '참조 대화 요약' }), { target: { value: 'manual' } })
  fireEvent.click(screen.getByRole('button', { name: '적용' }))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t/conversation-inputs/source' && init?.method === 'PUT')).toBe(true))
  const body = JSON.parse(String(calls.find(([url, init]) => url === '/api/tasks/t/conversation-inputs/source' && init?.method === 'PUT')![1]?.body))
  expect(body.summary.messageIds).toEqual(['m1'])
  expect(calls.some(([url]) => url.endsWith('/summary-draft'))).toBe(false)
})
