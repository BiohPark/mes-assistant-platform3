import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { TaskBody } from './TaskBody'

const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' } satisfies Task
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.removeItem('mes-chat-attempt:h-pending') })

it.each(['narrow', 'wide'] as const)('moves keyboard focus to the visible materials tab when opening materials (%s)', async (layout) => {
  const user = userEvent.setup()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [] })
    return jsonResponse(200, [])
  }))
  // jsdom does not load Tailwind: model the tablist and chat visibility at each breakpoint.
  renderWithProviders(<><style>{layout === 'narrow'
    ? '[role="tablist"][aria-label="보조 패널"], section.hidden { display: none; }'
    : '[role="tablist"][aria-label="대화 화면 탭"] { display: none; }'}</style><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><TaskBody task={task} assistant={{ id: 'a', name: '도우미' } as Assistant} /></TooltipProvider></MeContext></>)
  const opener = await screen.findByRole('button', { name: '자료 열기' })
  opener.focus()
  await user.keyboard('{Enter}')
  const tabs = within(screen.getByRole('tablist', { name: layout === 'narrow' ? '대화 화면 탭' : '보조 패널' }))
  expect(tabs.getByRole('tab', { name: '자료' })).toHaveAttribute('aria-selected', 'true')
  expect(tabs.getByRole('tab', { name: '자료' })).toHaveFocus()
  if (layout === 'narrow') expect(opener).not.toBeVisible()
})

it('constrains the chat column on narrow screens and flags the header tools hidden outside the chat tab', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    return jsonResponse(200, [])
  }))
  const headerTools = document.body.appendChild(document.createElement('div')) // 헤더의 도구 자리(포털 대상)
  try {
    renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><TaskBody task={task} assistant={{ id: 'a', name: '도우미' } as Assistant} headerTools={headerTools} /></TooltipProvider></MeContext>)
    // 모바일도 minmax(0,1fr) — auto 열이면 입력창 아래 줄 최소 폭만큼 가로로 넘친다
    expect(screen.getByRole('region', { name: '대화' }).parentElement).toHaveClass('grid-cols-[minmax(0,1fr)]', 'lg:grid-cols-[minmax(0,1fr)_360px]')
    expect(within(headerTools).getByRole('button', { name: '대화 내 검색' })).toBeInTheDocument()
    expect(headerTools.dataset.chatHidden).toBe('false')
    const mobileTabs = within(screen.getByRole('tablist', { name: '대화 화면 탭' }))
    fireEvent.click(mobileTabs.getByRole('tab', { name: '자료' }))
    expect(headerTools.dataset.chatHidden).toBe('true')
    fireEvent.click(mobileTabs.getByRole('tab', { name: '대화' }))
    expect(headerTools.dataset.chatHidden).toBe('false')
  } finally { headerTools.remove() }
})

it('offers narrow-screen tabs, placeholders, and the activity panel', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/tasks/t/activity') return jsonResponse(200, [{ id: 'event', taskId: 't', userId: 'u', type: 'task.reopened', payload: { reason: '추가 확인' }, at: '2026-09-28T00:00:00.000Z' }])
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><TaskBody task={task} assistant={{ id: 'a', name: '도우미' } as Assistant} /></TooltipProvider></MeContext>)
  const mobileTabs = within(screen.getByRole('tablist', { name: '대화 화면 탭' }))
  fireEvent.click(mobileTabs.getByRole('tab', { name: '자료' }))
  expect(screen.getByTestId('materials-library')).toBeInTheDocument()
  fireEvent.click(mobileTabs.getByRole('tab', { name: '이력' }))
  expect(await screen.findByText('사유: 추가 확인')).toBeInTheDocument()
})

it('방향키로 보조 패널 탭을 옮기고 단일 tabpanel이 활성 탭을 가리킨다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/tasks/t/activity') return jsonResponse(200, [])
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><TaskBody task={task} assistant={{ id: 'a', name: '도우미' } as Assistant} /></TooltipProvider></MeContext>)
  const panelTabs = within(screen.getByRole('tablist', { name: '보조 패널' }))
  const history = panelTabs.getByRole('tab', { name: '이력' })
  const materials = panelTabs.getByRole('tab', { name: '자료' })
  // 기본 탭은 자료(S14)
  expect(materials).toHaveAttribute('tabindex', '0')
  expect(history).toHaveAttribute('tabindex', '-1')
  const panel = screen.getByRole('tabpanel', { name: /^(이력|자료)$/ })
  expect(materials.id).toBeTruthy()
  expect(panel).toHaveAttribute('aria-labelledby', materials.id)
  expect(materials).toHaveAttribute('aria-controls', panel.id)

  materials.focus()
  fireEvent.keyDown(materials, { key: 'End' })
  expect(history).toHaveAttribute('aria-selected', 'true')
  expect(history).toHaveFocus()
  expect(screen.getByRole('tabpanel', { name: /^(이력|자료)$/ })).toHaveAttribute('aria-labelledby', history.id)
  fireEvent.keyDown(history, { key: 'ArrowRight' })
  expect(materials).toHaveAttribute('aria-selected', 'true')
  expect(materials).toHaveFocus()
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1)

  // 좁은 화면 탭도 같은 훅 — 대화에서 → 는 자료로 가고 채팅 영역은 계속 마운트돼 있다
  const mobileTabs = within(screen.getByRole('tablist', { name: '대화 화면 탭' }))
  const chat = mobileTabs.getByRole('tab', { name: '대화' })
  chat.focus()
  fireEvent.keyDown(chat, { key: 'ArrowRight' })
  expect(mobileTabs.getByRole('tab', { name: '자료' })).toHaveAttribute('aria-selected', 'true')
  expect(mobileTabs.getByRole('tab', { name: '자료' })).toHaveFocus()
  expect(screen.getByRole('tabpanel', { name: /^(이력|자료)$/ })).toHaveAttribute('aria-labelledby', materials.id)
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
      inputs: [], srCodes: [], srs: [], overLimit: false, attachmentLimit: 20,
    })
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    if (url === '/api/settings') return jsonResponse(200, { fileMaxPerRequest: 20 })
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [] })
    return jsonResponse(200, [])
  })
  vi.stubGlobal('fetch', fetchMock)
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><TaskBody task={{ ...task, threadId: 'h-pending' }} assistant={{ id: 'a', name: '도우미' } as Assistant} /></TooltipProvider></MeContext>)
  const chat = () => within(screen.getByRole('region', { name: '대화' }))
  const input = chat().getByRole('textbox')
  const composer = input.parentElement!.parentElement!
  const draft = '응답을 기다리는 AI 요청'
  fireEvent.change(input, { target: { value: draft } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/threads/h-pending/requests', expect.objectContaining({ method: 'POST' })))

  let expectedDraft = ''
  function expectComposerPreserved() {
    const currentInput = chat().getByRole('textbox', { hidden: true })
    expect(currentInput.parentElement!.parentElement!).toBe(composer)
    expect(currentInput).toBe(input)
    expect(currentInput).toHaveValue(expectedDraft)
    expect(chat().getByRole('timer', { hidden: true })).toBeInTheDocument()
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
  if (waitingFor === 'stream') {
    expectedDraft = '응답 중 작성한 다음 질문'
    fireEvent.change(input, { target: { value: expectedDraft } })
  }

  // jsdom에서는 반응형 CSS 대신 두 tablist의 실제 키보드 핸들러를 실행한다.
  const panelTabs = within(screen.getByRole('tablist', { name: '보조 패널' }))
  const mobileTabs = within(screen.getByRole('tablist', { name: '대화 화면 탭' }))
  for (const [tabs, steps] of [
    [panelTabs, [['자료', 'End', '이력'], ['이력', 'ArrowRight', '자료'], ['자료', 'ArrowLeft', '이력'], ['이력', 'Home', '자료']]],
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

it('defaults to materials and opens materials on both layouts without remounting chat or selecting inputs', async () => {
  const calls: Array<{ url: string; method?: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method })
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [] })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><TaskBody task={task} assistant={{ id: 'a', name: '도우미' } as Assistant} /></TooltipProvider></MeContext>)
  const desktop = within(screen.getByRole('tablist', { name: '보조 패널' }))
  const mobile = within(screen.getByRole('tablist', { name: '대화 화면 탭' }))
  expect(desktop.getByRole('tab', { name: '자료' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByTestId('materials-panel')).toBeInTheDocument()
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

it('S15: 대화 두 개를 함께 살려 둬도 보조 패널 탭·패널 id가 겹치지 않는다', () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/llm/models' ? jsonResponse(200, { models: [] }) : jsonResponse(200, [])))
  const me = { id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }
  renderWithProviders(<MeContext value={me}><TooltipProvider>
    <TaskBody task={task} assistant={{ id: 'a', name: '도우미' } as Assistant} />
    <TaskBody task={{ ...task, id: 't2', threadId: 'h2' }} assistant={{ id: 'a', name: '도우미' } as Assistant} />
  </TooltipProvider></MeContext>)
  const ids = [...document.querySelectorAll('[id]')].map(element => element.id).filter(id => id.startsWith('task-'))
  expect(ids.length).toBeGreaterThan(0)
  expect(new Set(ids).size).toBe(ids.length)
  for (const tablist of screen.getAllByRole('tablist', { name: '보조 패널' })) {
    const selected = within(tablist).getByRole('tab', { selected: true })
    const panel = document.getElementById(selected.getAttribute('aria-controls')!)!
    expect(panel.getAttribute('aria-labelledby')).toBe(selected.id)
    expect(tablist.parentElement!.contains(panel)).toBe(true)
  }
})
