import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { ChecklistPanel } from './ChecklistPanel'

afterEach(() => vi.unstubAllGlobals())

const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-01-01T00:00:00.000Z' } satisfies Task

it('explains rule fallback in saved results after reloading the task', () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  renderWithProviders(<ChecklistPanel task={{ ...task, checklistReview: { by: 'u', at: task.createdAt, met: 0, total: 0, source: 'rule', items: [] } }} />)
  expect(screen.getByText('AI 응답을 사용할 수 없어 규칙으로 판단했습니다.')).toBeVisible()
})

it('keeps the add button available after typing a checklist item', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') calls.push(url)
    return jsonResponse(200, [])
  }))
  renderWithProviders(<ChecklistPanel task={task} />)
  const panel = screen.getByTestId('checklist-panel')
  fireEvent.change(screen.getByRole('textbox', { name: '체크리스트 새 항목' }), { target: { value: '근거 확인' } })
  const button = panel.querySelector('button[type="submit"]')!
  expect(button).toHaveAccessibleName('추가')
  expect(button).toBeEnabled()
  fireEvent.click(button)
  expect(calls).toContain('/api/tasks/t/checklist')
})

it('clears on submit, locks the form, and keeps the next item after the request finishes', async () => {
  let finish!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { finish = resolve })
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => init?.method === 'POST' && url === '/api/tasks/t/checklist' ? pending : Promise.resolve(jsonResponse(200, []))))
  renderWithProviders(<ChecklistPanel task={task} />)
  const input = screen.getByRole('textbox', { name: '체크리스트 새 항목' })
  const button = screen.getByRole('button', { name: '추가' })
  fireEvent.change(input, { target: { value: '근거 확인' } })
  fireEvent.click(button)
  expect(input).toHaveValue('')
  expect(input).toBeDisabled()
  expect(button).toBeDisabled()

  finish(jsonResponse(200, []))
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, { target: { value: '승인 확인' } })
  expect(input).toHaveValue('승인 확인')
  expect(button).toBeEnabled()
})

it('restores the submitted item when adding fails', async () => {
  let fail!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { fail = resolve })
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => init?.method === 'POST' && url === '/api/tasks/t/checklist' ? pending : Promise.resolve(jsonResponse(200, []))))
  renderWithProviders(<ChecklistPanel task={task} />)
  const input = screen.getByRole('textbox', { name: '체크리스트 새 항목' })
  fireEvent.change(input, { target: { value: '근거 확인' } })
  fireEvent.click(screen.getByRole('button', { name: '추가' }))
  expect(input).toHaveValue('')
  expect(input).toBeDisabled()
  fail(jsonResponse(500, { message: '추가 실패' }))
  await waitFor(() => expect(input).toHaveValue('근거 확인'))
  expect(input).toBeEnabled()
})

it('renders each item as a checkbox named by its label and toggles it on the server', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') calls.push(url)
    return jsonResponse(200, [])
  }))
  const checklist = [{ id: 'c1', label: '근거 확인', required: true, checked: false }, { id: 'c2', label: '승인 확인', required: false, checked: true, checkedBy: 'u', checkedAt: '2026-01-01T00:00:00.000Z' }]
  renderWithProviders(<ChecklistPanel task={{ ...task, checklist }} />)
  const first = screen.getByRole('checkbox', { name: '근거 확인' })
  expect(first).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: '승인 확인' })).toBeChecked()
  fireEvent.click(first)
  await waitFor(() => expect(calls).toContain('/api/tasks/t/checklist/c1'))
})

it('locks the item checkboxes when the task is done', () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  renderWithProviders(<ChecklistPanel task={{ ...task, status: 'done', checklist: [{ id: 'c1', label: '근거 확인', required: false, checked: false }] }} />)
  expect(screen.getByRole('checkbox', { name: '근거 확인' })).toBeDisabled()
})

it('uses warning text for required items and a success foreground for checklist progress', () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  renderWithProviders(<ChecklistPanel task={{ ...task, checklist: [
    { id: 'c1', label: '근거 확인', required: true, checked: false },
    { id: 'c2', label: '승인 확인', required: false, checked: true },
  ] }} />)
  expect(screen.getByText('중요 1개 미체크')).toHaveClass('text-tone-warning-fg')
  expect(screen.getByText('중요', { exact: true })).toHaveClass('text-tone-warning-fg')
  const bar = screen.getByTestId('checklist-panel').querySelector('div[style]')
  expect(bar).toHaveClass('bg-tone-success-fg')
  expect(bar).toHaveStyle({ width: '50%' })
})


it.each(['ai', 'rule'])('shows elapsed progress and streamed items before the saved %s review completes', async source => {
  let stream!: ReadableStreamDefaultController<Uint8Array>
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/checklist/review')
    ? new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }), { headers: { 'Content-Type': 'text/event-stream' } })
    : jsonResponse(200, [])))
  renderWithProviders(<ChecklistPanel task={{ ...task, checklist: [{ id: 'c1', label: '근거 확인', required: true, checked: false }] }} />)
  fireEvent.click(screen.getByRole('button', { name: 'AI 달성도 점검' }))
  expect(screen.getByRole('status')).toHaveTextContent('생각 중')
  expect(screen.getByRole('timer')).toHaveTextContent('0초 경과')
  expect(screen.getByRole('button', { name: 'AI 달성도 점검' })).toBeDisabled()
  const encoder = new TextEncoder()
  await waitFor(() => expect(stream).toBeDefined())
  await act(async () => { stream.enqueue(encoder.encode('event: item\ndata: {"itemId":"c1","met":true,"note":"근거를 확인했습니다"}\n\n')) })
  expect(screen.getByText('근거를 확인했습니다')).toBeVisible()
  expect(screen.getByRole('timer')).toBeVisible()
  expect(screen.queryByRole('button', { name: '판단대로 체크' })).not.toBeInTheDocument()
  const result = { by: 'u', at: task.createdAt, met: 1, total: 1, source, items: [{ itemId: 'c1', met: true, note: '저장된 근거' }] }
  await act(async () => { stream.enqueue(encoder.encode(`event: completed\ndata: ${JSON.stringify(result)}\n\n`)); stream.close() })
  expect(await screen.findByText('저장된 근거')).toBeVisible()
  expect(screen.queryByText('근거를 확인했습니다')).not.toBeInTheDocument()
  if (source === 'rule') expect(screen.getByText('AI 응답을 사용할 수 없어 규칙으로 판단했습니다.')).toBeVisible()
  else expect(screen.queryByText('AI 응답을 사용할 수 없어 규칙으로 판단했습니다.')).not.toBeInTheDocument()
  expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'AI 달성도 점검' })).toBeEnabled()
})


it.each(['failed', 'disconnected'])('discards provisional review items after %s and keeps the previous saved review', async mode => {
  let stream!: ReadableStreamDefaultController<Uint8Array>
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/checklist/review')
    ? new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } })) : jsonResponse(200, [])))
  const checklist = [{ id: 'c1', label: '근거 확인', required: false, checked: false }]
  const checklistReview = { by: 'u', at: task.createdAt, met: 0, total: 1, source: 'rule' as const, items: [{ itemId: 'c1', met: false, note: '기존 저장 결과' }] }
  renderWithProviders(<ChecklistPanel task={{ ...task, checklist, checklistReview }} />)
  fireEvent.click(screen.getByRole('button', { name: 'AI 달성도 점검' }))
  await waitFor(() => expect(stream).toBeDefined())
  const encoder = new TextEncoder()
  await act(async () => { stream.enqueue(encoder.encode('event: item\ndata: {"itemId":"c1","met":true,"note":"임시 판단"}\n\n')) })
  expect(screen.getByText('임시 판단')).toBeVisible()
  await act(async () => {
    if (mode === 'failed') stream.enqueue(encoder.encode('event: failed\ndata: {"error":"저장 실패"}\n\n'))
    stream.close()
  })
  expect(await screen.findByText('기존 저장 결과')).toBeVisible()
  expect(screen.queryByText('임시 판단')).not.toBeInTheDocument()
  expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'AI 달성도 점검' })).toBeEnabled()
})

it('counts review seconds and aborts the request when leaving the panel', async () => {
  let signal!: AbortSignal
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/checklist/review')) { signal = init!.signal!; return new Promise<Response>(() => undefined) }
    return jsonResponse(200, [])
  }))
  const { unmount } = renderWithProviders(<ChecklistPanel task={{ ...task, checklist: [{ id: 'c1', label: '근거 확인', required: false, checked: false }] }} />)
  vi.useFakeTimers()
  try {
    fireEvent.click(screen.getByRole('button', { name: 'AI 달성도 점검' }))
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByRole('timer')).toHaveTextContent('3초 경과')
    unmount()
    expect(signal.aborted).toBe(true)
  } finally { vi.useRealTimers() }
})
