import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { TaskBody } from './TaskBody'

const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' } satisfies Task
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.removeItem('mes-chat-attempt:h-pending') })

it('offers narrow-screen tabs, placeholders, and the activity panel', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/tasks/t/activity') return jsonResponse(200, [{ id: 'event', taskId: 't', userId: 'u', type: 'task.reopened', payload: { reason: '추가 확인' }, at: '2026-09-28T00:00:00.000Z' }])
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><TaskBody task={task} assistant={{ id: 'a', name: '도우미' } as Assistant} /></TooltipProvider></MeContext>)
  const mobileTabs = within(screen.getByRole('tablist', { name: '대화 화면 탭' }))
  fireEvent.click(mobileTabs.getByRole('tab', { name: '자료' }))
  expect(screen.getByRole('tablist', { name: '자료 탭' })).toBeInTheDocument()
  fireEvent.click(mobileTabs.getByRole('tab', { name: '이력' }))
  expect(await screen.findByText('사유: 추가 확인')).toBeInTheDocument()
})

it('방향키로 보조 패널 탭을 옮기고 단일 tabpanel이 활성 탭을 가리킨다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/tasks/t/activity') return jsonResponse(200, [])
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><TaskBody task={task} assistant={{ id: 'a', name: '도우미' } as Assistant} /></TooltipProvider></MeContext>)
  const panelTabs = within(screen.getByRole('tablist', { name: '보조 패널' }))
  const history = panelTabs.getByRole('tab', { name: '이력' })
  expect(history).toHaveAttribute('id', 'task-tab-history')
  expect(history).toHaveAttribute('tabindex', '0')
  expect(panelTabs.getByRole('tab', { name: '자료' })).toHaveAttribute('tabindex', '-1')
  const panel = screen.getByRole('tabpanel', { name: /^(이력|자료)$/ })
  expect(panel).toHaveAttribute('id', 'task-panel')
  expect(panel).toHaveAttribute('aria-labelledby', 'task-tab-history')
  expect(history).toHaveAttribute('aria-controls', 'task-panel')

  history.focus()
  fireEvent.keyDown(history, { key: 'ArrowRight' })
  const materials = panelTabs.getByRole('tab', { name: '자료' })
  expect(materials).toHaveAttribute('aria-selected', 'true')
  expect(materials).toHaveFocus()
  expect(screen.getByRole('tabpanel', { name: /^(이력|자료)$/ })).toHaveAttribute('aria-labelledby', 'task-tab-materials')
  fireEvent.keyDown(materials, { key: 'End' })
  expect(panelTabs.getByRole('tab', { name: '이력' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1)

  // 좁은 화면 탭도 같은 훅 — 대화에서 → 는 자료로 가고 채팅 영역은 계속 마운트돼 있다
  const mobileTabs = within(screen.getByRole('tablist', { name: '대화 화면 탭' }))
  const chat = mobileTabs.getByRole('tab', { name: '대화' })
  chat.focus()
  fireEvent.keyDown(chat, { key: 'ArrowRight' })
  expect(mobileTabs.getByRole('tab', { name: '자료' })).toHaveAttribute('aria-selected', 'true')
  expect(mobileTabs.getByRole('tab', { name: '자료' })).toHaveFocus()
  expect(screen.getByRole('tabpanel', { name: /^(이력|자료)$/ })).toHaveAttribute('aria-labelledby', 'task-tab-materials')
  expect(screen.getByRole('region', { name: '대화' })).toBeInTheDocument()
  fireEvent.keyDown(mobileTabs.getByRole('tab', { name: '자료' }), { key: 'Home' })
  expect(chat).toHaveAttribute('aria-selected', 'true')
  expect(chat).toHaveFocus()
})

it.each(['fetch', 'stream'] as const)('AI 응답 대기 중 키보드 탭 전환이 Composer와 입력·전송 상태를 유지한다 (%s)', async (waitingFor) => {
  const pendingResponse = new Promise<Response>(() => {})
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/threads/h-pending/requests') {
      if (waitingFor === 'fetch') return pendingResponse
      // started만 전달하고 스트림을 닫지 않아 AI 응답 완료를 계속 기다린다.
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode('event: started\ndata: {"requestId":"r-pending","replyMessageId":"reply-pending","userMessageId":"user-pending"}\n\n'))
      } }), { status: 201, headers: { 'content-type': 'text/event-stream' } })
    }
    if (url === '/api/threads/h-pending/requests/estimate') return jsonResponse(200, {
      at: task.createdAt, provider: 'mock', transport: 'inline', model: 'mock', bytes: 100, limitBytes: 10_000,
      inputs: [], srCodes: [], overLimit: false, attachmentLimit: 20,
    })
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    if (url === '/api/settings') return jsonResponse(200, { fileMaxPerRequest: 20 })
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [] })
    return jsonResponse(200, [])
  })
  vi.stubGlobal('fetch', fetchMock)
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><TaskBody task={{ ...task, threadId: 'h-pending' }} assistant={{ id: 'a', name: '도우미' } as Assistant} /></TooltipProvider></MeContext>)
  const chat = () => within(screen.getByRole('region', { name: '대화' }))
  const input = chat().getByRole('textbox')
  const composer = input.parentElement!.parentElement!
  const draft = '응답을 기다리는 AI 요청'
  fireEvent.change(input, { target: { value: draft } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/threads/h-pending/requests', expect.objectContaining({ method: 'POST' })))

  function expectComposerPreserved() {
    const currentInput = chat().getByRole('textbox', { hidden: true })
    expect(currentInput.parentElement!.parentElement!).toBe(composer)
    expect(currentInput).toBe(input)
    expect(currentInput).toHaveValue(draft)
    if (waitingFor === 'fetch') {
      expect(currentInput).toBeDisabled()
      expect(chat().getByRole('button', { name: '전송', hidden: true })).toBeDisabled()
      expect(chat().queryByRole('button', { name: '중지', hidden: true })).not.toBeInTheDocument()
    } else {
      expect(currentInput).toBeEnabled()
      expect(chat().getByRole('button', { name: '중지', hidden: true })).toBeEnabled()
      expect(chat().queryByRole('button', { name: '전송', hidden: true })).not.toBeInTheDocument()
    }
  }
  await waitFor(expectComposerPreserved)

  // jsdom에서는 반응형 CSS 대신 두 tablist의 실제 키보드 핸들러를 실행한다.
  const panelTabs = within(screen.getByRole('tablist', { name: '보조 패널' }))
  const mobileTabs = within(screen.getByRole('tablist', { name: '대화 화면 탭' }))
  for (const [tabs, steps] of [
    [panelTabs, [['이력', 'ArrowRight', '자료'], ['자료', 'ArrowLeft', '이력'], ['이력', 'Home', '자료'], ['자료', 'End', '이력']]],
    [mobileTabs, [['대화', 'ArrowRight', '자료'], ['자료', 'ArrowRight', '체크'], ['체크', 'ArrowLeft', '자료'], ['자료', 'Home', '대화'], ['대화', 'End', '이력'], ['이력', 'Home', '대화']]],
  ] as const) {
    for (const [from, key, to] of steps) {
      const tab = tabs.getByRole('tab', { name: from })
      tab.focus()
      fireEvent.keyDown(tab, { key })
      const selected = tabs.getByRole('tab', { name: to })
      expect(selected).toHaveAttribute('aria-selected', 'true')
      expect(selected).toHaveFocus()
      expectComposerPreserved()
    }
  }
})

it('keeps history as the default and opens materials on both layouts without remounting chat or selecting inputs', async () => {
  const calls: Array<{ url: string; method?: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method })
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [] })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><TaskBody task={task} assistant={{ id: 'a', name: '도우미' } as Assistant} /></TooltipProvider></MeContext>)
  const desktop = within(screen.getByRole('tablist', { name: '보조 패널' }))
  const mobile = within(screen.getByRole('tablist', { name: '대화 화면 탭' }))
  expect(desktop.getByRole('tab', { name: '이력' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByTestId('materials-panel')).not.toBeInTheDocument()
  expect(calls.some(({ url }) => url.includes('candidates'))).toBe(false)
  const input = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  fireEvent.change(input, { target: { value: '유지할 입력' } })
  fireEvent.click(await screen.findByRole('button', { name: '자료 열기' }))
  expect(desktop.getByRole('tab', { name: '자료' })).toHaveAttribute('aria-selected', 'true')
  expect(mobile.getByRole('tab', { name: '자료' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByTestId('materials-panel')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력', hidden: true })).toBe(input)
  expect(input).toHaveValue('유지할 입력')
  await waitFor(() => expect(calls.filter(({ url }) => url === '/api/tasks/t/candidates')).toHaveLength(1))
  expect(calls.some(({ url }) => /\/(?:conversation-)?inputs(?:\/|$)/.test(url) && calls.find(call => call.url === url)?.method !== 'GET')).toBe(false)
  expect(task.inputs).toEqual([])
})
