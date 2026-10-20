import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Message } from '@mes/domain'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ChatMessages, failedQuestionIds } from './ChatMessages'

const question: Message = { id: 'q', threadId: 'h', role: 'user', content: '첫 질문', status: 'done', attachmentIds: [], createdAt: '2026-01-01T00:00:00Z', requestId: 'r' }
const answer: Message = { ...question, id: 'a', role: 'assistant', content: '답변', status: 'error', error: '실패' }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
function view(messages: Message[], text?: string) {
  return <QueryClientProvider client={new QueryClient()}><TooltipProvider><div data-testid="scroll" style={{ overflowY: 'auto' }}><ChatMessages messages={messages} run={text === undefined ? null : { requestId: 'r', replyId: 'a', text }} /></div></TooltipProvider></QueryClientProvider>
}

it('follows new content only near the bottom and offers a keyboard jump otherwise', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  const scrollIntoView = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
  const { rerender } = render(view([question, answer]))
  expect(scrollIntoView).toHaveBeenCalled()
  const scroll = screen.getByTestId('scroll')
  Object.defineProperties(scroll, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 }, scrollTop: { configurable: true, writable: true, value: 100 } })
  fireEvent.scroll(scroll)
  scrollIntoView.mockClear()
  rerender(view([question, answer], '새 토큰'))
  expect(scrollIntoView).not.toHaveBeenCalled()
  const jump = screen.getByRole('button', { name: '맨 아래로' })
  jump.focus()
  await userEvent.setup().keyboard('{Enter}')
  expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'instant', block: 'end' }))
  expect(screen.queryByRole('button', { name: '맨 아래로' })).not.toBeInTheDocument()
  expect(document.querySelector('[data-message-id="a"]')).toHaveFocus()
  scroll.scrollTop = 780
  fireEvent.scroll(scroll)
  scrollIntoView.mockClear()
  rerender(view([question, answer], '이어지는 토큰'))
  expect(scrollIntoView).toHaveBeenCalled()
})

it('lists question times and failure labels and focuses the selected message after closing', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  render(view([question, answer, { ...question, id: 'team', kind: 'discussion', content: '팀 의견' }]))
  const user = userEvent.setup()
  screen.getByRole('button', { name: '질문 목차' }).focus()
  await user.keyboard('{Enter}')
  const index = await screen.findByRole('dialog', { name: '질문 목차' })
  expect(within(index).getByText('실패')).toBeVisible()
  expect(index.querySelector('time')).toHaveAttribute('datetime', question.createdAt)
  expect(within(index).queryByText('팀 의견')).not.toBeInTheDocument()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(document.querySelector('[data-message-id="q"]')).toHaveFocus()
})

it('keeps the inline question index in normal flow for shared message views', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  render(view([question, answer]))
  const trigger = screen.getByRole('button', { name: '질문 목차' })
  const toolbar = trigger.parentElement!
  expect(toolbar).toContainElement(screen.getByRole('button', { name: '대화 내 검색' }))
  expect(toolbar.nextElementSibling).toHaveAttribute('data-message-id', question.id)
  expect(toolbar).not.toHaveClass('sticky')
  expect(toolbar).not.toHaveClass('absolute')
  expect(toolbar).not.toHaveClass('fixed')
})

it('marks a question failed only by an error answer in its own span that matches its request', () => {
  const second: Message = { ...question, id: 'q2', content: '둘째 질문', requestId: 'r2' }
  const third: Message = { ...question, id: 'q3', content: '셋째 질문', requestId: undefined }
  const failed = failedQuestionIds([
    { ...answer, id: 'orphan' }, question, { ...answer, requestId: 'other' }, { ...question, id: 'team', kind: 'discussion' },
    second, { ...answer, id: 'a2', requestId: 'r2' }, third, { ...answer, id: 'a3', requestId: 'any' }, { ...answer, id: 'ok', status: 'done' },
  ])
  expect([...failed]).toEqual(['q2', 'q3'])
})

it.each([
  { label: 'an empty conversation', messages: [] as Message[] },
  { label: 'a conversation with a user question', messages: [question] },
])('counts elapsed seconds in the placeholder header for $label through waiting, thinking and answering, then stops', ({ messages }) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  const startedAt = Date.now()
  const client = new QueryClient()
  const view = (run: import('./useChat').ChatRun | null, waitingSince?: number) => <QueryClientProvider client={client}><TooltipProvider><ChatMessages messages={messages} run={run} waitingSince={waitingSince} /></TooltipProvider></QueryClientProvider>
  const { rerender } = render(view(null, startedAt))
  const header = screen.getByRole('status').parentElement!
  expect(screen.getByRole('status')).toHaveTextContent('대기 중')
  expect(header).toHaveTextContent('에이전트')
  expect(within(header).getByRole('timer')).toHaveTextContent('0초 경과')
  expect(screen.getAllByRole('timer')).toHaveLength(1)
  expect(document.querySelector('[data-message-id="waiting-assistant"] .md-body')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(2000))
  expect(within(header).getByRole('timer')).toHaveTextContent('2초 경과')
  rerender(view({ requestId: 'r', replyId: 'a', text: '', reasoning: '검토', phase: '생각 중', startedAt }))
  expect(screen.getByRole('status')).toHaveTextContent('생각 중')
  expect(screen.getByRole('status').parentElement).toContainElement(screen.getByRole('timer'))
  expect(document.querySelector('[data-reasoning-preview]')).toHaveTextContent('검토')
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByRole('timer')).toHaveTextContent('3초 경과')
  rerender(view({ requestId: 'r', replyId: 'a', text: '답', phase: '답변 중', startedAt }))
  expect(screen.getByRole('status')).toHaveTextContent('답변 작성 중')
  rerender(view(null))
  expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  expect(document.querySelector('[data-message-id="waiting-assistant"]')).not.toBeInTheDocument()
})

it('translates progress and thinking statuses in English and counts a resumed remote request', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:05Z'))
  const client = new QueryClient()
  const pending: Message = { ...answer, status: 'streaming', content: '', error: undefined, reasoning: '검토 중' }
  const view = (run: import('./useChat').ChatRun | null) => <QueryClientProvider client={client}><I18nProvider locale="en"><ChatMessages messages={[pending]} run={run} /></I18nProvider></QueryClientProvider>
  const { container, rerender } = render(view(null))
  expect(screen.getByRole('status')).toHaveTextContent('Thinking')
  expect(screen.getByRole('timer')).toHaveTextContent('5s elapsed')
  expect(screen.getByText('Thinking process')).toBeInTheDocument()
  expect(container.querySelector('details')).toHaveClass('bg-muted', 'text-foreground')
  expect(container.querySelector('details')?.className).not.toMatch(/animate|transition/)
  rerender(view({ requestId: 'r', replyId: 'a', text: '', phase: '파일 처리 대기 1/2 · sample.txt', startedAt: Date.parse(pending.createdAt) }))
  expect(screen.getByRole('status')).toHaveTextContent('Processing file 1/2 · sample.txt')
  expect(container).not.toHaveTextContent('파일 처리 대기')
})

it('places a single phase and timer in the active assistant header and preserves manual reasoning choice after messages load', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  const client = new QueryClient()
  const pending: Message = { ...answer, status: 'streaming', content: '', error: undefined, reasoning: '검토 중' }
  const view = (messages: Message[], text = '', phase = '생각 중') => <QueryClientProvider client={client}><TooltipProvider><ChatMessages messages={messages}
    run={{ requestId: 'r', replyId: 'a', text, reasoning: '검토 중', phase, startedAt: Date.parse(pending.createdAt) }} /></TooltipProvider></QueryClientProvider>
  const { container, rerender } = render(view([question]))
  await userEvent.setup().click(screen.getByText('생각 과정'))
  expect(container.querySelector('details')?.open).toBe(true)
  rerender(view([question, pending]))
  expect(container.querySelectorAll('[data-message-id="a"]')).toHaveLength(1)
  expect(container.querySelector('details')?.open).toBe(true)
  const header = screen.getByRole('status').parentElement!
  expect(header).toContainElement(screen.getByRole('timer'))
  expect(header).toHaveTextContent('에이전트')
  expect(screen.getAllByRole('status')).toHaveLength(1)
  expect(screen.queryByText('응답 중…')).not.toBeInTheDocument()
  expect(container.querySelectorAll('.md-body')).toHaveLength(1)
  rerender(view([question, pending], '실제 답변', '생각 중'))
  expect(screen.getByRole('status')).toHaveTextContent('답변 작성 중')
  expect(container.querySelectorAll('.md-body')).toHaveLength(2)
  expect(container.querySelector('details')?.open).toBe(true)
})

it('shows scrollToBottom immediately above 200px and hides it at or below the threshold', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  render(view([question, answer]))
  const scroll = screen.getByTestId('scroll')
  Object.defineProperties(scroll, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 }, scrollTop: { configurable: true, writable: true, value: 599 } })
  expect(screen.queryByRole('button', { name: '맨 아래로' })).not.toBeInTheDocument()
  fireEvent.scroll(scroll)
  expect(screen.getByRole('button', { name: '맨 아래로' })).toBeInTheDocument()
  scroll.scrollTop = 600
  fireEvent.scroll(scroll)
  expect(screen.queryByRole('button', { name: '맨 아래로' })).not.toBeInTheDocument()
  scroll.scrollTop = 800
  fireEvent.scroll(scroll)
  expect(screen.queryByRole('button', { name: '맨 아래로' })).not.toBeInTheDocument()
})

it('opens search from an icon, searches only message bodies, cycles matches in both directions and closes on Escape', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  render(view([question, { ...answer, content: '첫 답변', reasoning: '비공개 생각' }]))
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  const toggle = screen.getByRole('button', { name: '대화 내 검색' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const input = screen.getByRole('searchbox', { name: '대화 내 검색' })
  await waitFor(() => expect(input).toHaveFocus())
  fireEvent.change(input, { target: { value: '첫' } })
  expect(screen.getByRole('status')).toHaveTextContent('1/2')
  expect(document.querySelector('[data-search-match="true"]')).toHaveAttribute('data-message-id', 'q')
  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  expect(screen.getByRole('status')).toHaveTextContent('2/2')
  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  expect(screen.getByRole('status')).toHaveTextContent('1/2')
  fireEvent.click(screen.getByRole('button', { name: '이전' }))
  expect(screen.getByRole('status')).toHaveTextContent('2/2')
  fireEvent.change(input, { target: { value: '비공개 생각' } })
  expect(screen.getByRole('status')).toHaveTextContent('0/0')
  expect(screen.getByRole('button', { name: '다음' })).toBeDisabled()
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  expect(document.querySelector('[data-search-match="true"]')).toBeNull()
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(toggle).toHaveFocus()
})


it('keeps the submission clock when the server starts later', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:07Z'))
  render(<QueryClientProvider client={new QueryClient()}><ChatMessages messages={[]} waitingSince={Date.now() - 7000}
    run={{ requestId: 'r', replyId: 'a', text: '', phase: '준비 중', startedAt: Date.now() - 1000 }} /></QueryClientProvider>)
  expect(screen.getByRole('timer')).toHaveTextContent('7초 경과')
  expect(screen.getByRole('status')).toHaveTextContent('준비 중')
})

it('S14: walks the stages, counts the last response, and switches to the limit countdown after a quiet spell', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  const startedAt = Date.now()
  const client = new QueryClient()
  const view = (run: import('./useChat').ChatRun) => <QueryClientProvider client={client}><TooltipProvider><ChatMessages messages={[question]} run={run} /></TooltipProvider></QueryClientProvider>
  const { container, rerender } = render(view({ requestId: 'r', replyId: 'a', text: '', startedAt }))
  const header = () => screen.getByRole('status').parentElement!
  expect(screen.getByRole('status')).toHaveTextContent('대기 중')
  expect(header()).not.toHaveTextContent('마지막 응답')
  expect(container.querySelector('[data-live-dot]')).toHaveClass('motion-safe:animate-pulse')
  act(() => vi.advanceTimersByTime(2000))
  rerender(view({ requestId: 'r', replyId: 'a', text: '', reasoning: '검토', phase: '생각 중', startedAt }))
  expect(screen.getByRole('status')).toHaveTextContent('생각 중')
  expect(header()).toHaveTextContent('마지막 응답 0초 전')
  act(() => vi.advanceTimersByTime(3000))
  expect(header()).toHaveTextContent('마지막 응답 3초 전')
  rerender(view({ requestId: 'r', replyId: 'a', text: '', reasoning: '검토', phase: 'URL 읽는 중: https://example.com', startedAt }))
  expect(screen.getByRole('status')).toHaveTextContent('URL 읽는 중: https://example.com')
  expect(header()).toHaveTextContent('마지막 응답 0초 전')
  rerender(view({ requestId: 'r', replyId: 'a', text: '답', reasoning: '검토', phase: '답변 중', startedAt }))
  expect(screen.getByRole('status')).toHaveTextContent('답변 작성 중')
  act(() => vi.advanceTimersByTime(19_000))
  expect(screen.getByRole('status')).toHaveTextContent('답변 작성 중')
  act(() => vi.advanceTimersByTime(2000))
  // 마지막 신호 5초 + 서버 무응답 제한 300초 - 지금 26초 = 279초
  expect(screen.getByRole('status')).toHaveTextContent('응답 대기 중')
  expect(header()).toHaveTextContent('제한까지 4분 39초')
  expect(container.querySelector('[data-live-dot]')).not.toHaveClass('motion-safe:animate-pulse')
  rerender(view({ requestId: 'r', replyId: 'a', text: '답이 이어진다', reasoning: '검토', phase: '답변 중', startedAt }))
  expect(screen.getByRole('status')).toHaveTextContent('답변 작성 중')
  expect(screen.getAllByRole('status')).toHaveLength(1)
  expect(screen.getAllByRole('timer')).toHaveLength(1)
})

it('S14: counts down the server limits of this request — first-token limit from its creation until a response arrives, then the idle limit', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:30Z'))
  const client = new QueryClient()
  const createdAt = Date.parse('2026-01-01T00:00:10Z') // 업로드 뒤 서버가 요청을 만든 시각 — 제출(00:00)보다 늦다
  const view = (run: import('./useChat').ChatRun) => <QueryClientProvider client={client}><TooltipProvider><ChatMessages messages={[question]} waitingSince={Date.parse('2026-01-01T00:00:00Z')} run={run} /></TooltipProvider></QueryClientProvider>
  const base = { requestId: 'r', replyId: 'a', startedAt: createdAt, firstTokenMs: 600_000, idleMs: 120_000 }
  const { rerender } = render(view({ ...base, text: '', phase: '파일 올리는 중 1/1 · a.pdf' }))
  const header = () => screen.getByRole('status').parentElement!
  // 파일 진행은 서버 제한을 다시 걸지 않는다 — 생성 10초 + 첫 응답 600초 - 지금 30초 = 580초
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByRole('status')).toHaveTextContent('응답 대기 중')
  expect(header()).toHaveTextContent('제한까지 9분 39초')
  rerender(view({ ...base, text: '', reasoning: '검토', phase: '생각 중' }))
  act(() => vi.advanceTimersByTime(25_000))
  // 생각(00:31) + 무응답 120초 - 지금 00:56 = 95초
  expect(header()).toHaveTextContent('제한까지 1분 35초')
})

it('S14-II: once the text stops, shows what is still running under the answer; OpenWebUI work counts toward the hard cap, not the idle limit', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  const startedAt = Date.now()
  const client = new QueryClient()
  const view = (run: import('./useChat').ChatRun) => <QueryClientProvider client={client}><TooltipProvider><ChatMessages messages={[question]} run={run} /></TooltipProvider></QueryClientProvider>
  const base = { requestId: 'r', replyId: 'a', startedAt, idleMs: 300_000, maxMs: 1_800_000 }
  const { container, rerender } = render(view({ ...base, text: '답', phase: '답변 중' }))
  const header = () => screen.getByRole('status').parentElement!
  const footer = () => screen.queryByTestId('reply-progress')
  expect(footer()).toBeNull()
  act(() => vi.advanceTimersByTime(3000))
  expect(footer()).toHaveTextContent('답변 작성 중')
  rerender(view({ ...base, text: '답', phase: '답변 마무리 중' }))
  expect(screen.getByRole('status')).toHaveTextContent('답변 마무리 중')
  expect(footer()).toHaveTextContent('답변 마무리 중')
  rerender(view({ ...base, text: '답', phase: '도구 실행 중: search_docs' }))
  expect(screen.getByRole('status')).toHaveTextContent('도구 실행: search_docs')
  rerender(view({ ...base, text: '답', phase: 'OpenWebUI에서 작업 중 · 도구 실행 중: search_docs' }))
  expect(screen.getByRole('status')).toHaveTextContent('OpenWebUI에서 작업 중 · 도구 실행: search_docs')
  expect(header()).toHaveTextContent('0초째')
  act(() => vi.advanceTimersByTime(125_000))
  // 조용해도 '응답 대기 중'이 아니다 — 작업 중이고, 남은 시간은 시작 + 최대 30분 - 지금 128초 = 1672초
  expect(screen.getByRole('status')).toHaveTextContent('OpenWebUI에서 작업 중 · 도구 실행: search_docs')
  expect(header()).toHaveTextContent('2분 5초째')
  expect(header()).toHaveTextContent('제한까지 27분 52초')
  expect(footer()).toHaveTextContent('OpenWebUI에서 작업 중 · 도구 실행: search_docs')
  expect(footer()).toHaveTextContent('제한까지 27분 52초')
  expect(container.querySelector('[data-live-dot]')).toHaveClass('motion-safe:animate-pulse')
  rerender(view({ ...base, text: '답이 이어진다', phase: '답변 중' }))
  expect(footer()).toBeNull()
  expect(screen.getAllByRole('status')).toHaveLength(1)
})

it('S14: a new request starts its quiet clock from its own start, not from the previous answer', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  const client = new QueryClient()
  const view = (run: import('./useChat').ChatRun | null) => <QueryClientProvider client={client}><TooltipProvider><ChatMessages messages={[question]} run={run} /></TooltipProvider></QueryClientProvider>
  const { rerender } = render(view({ requestId: 'r', replyId: 'a', text: '답', startedAt: Date.now() }))
  rerender(view(null))
  act(() => vi.advanceTimersByTime(60_000))
  rerender(view({ requestId: 'r2', replyId: 'b', text: '', startedAt: Date.now() }))
  expect(screen.getByRole('status')).toHaveTextContent('대기 중')
  expect(screen.getByRole('status').parentElement).not.toHaveTextContent('마지막 응답')
})

it('S14: keeps following the bottom while typed-out text grows the conversation, unless the reader scrolled up', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  const observers: Array<() => void> = []
  const original = globalThis.ResizeObserver
  globalThis.ResizeObserver = class { constructor(callback: () => void) { observers.push(callback) } observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  onTestFinished(() => { globalThis.ResizeObserver = original })
  const scrollIntoView = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
  render(view([question, answer]))
  expect(observers.length).toBeGreaterThan(0)
  scrollIntoView.mockClear()
  act(() => observers.forEach((callback) => callback()))
  expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'end', behavior: 'instant' }))
  const scroll = screen.getByTestId('scroll')
  Object.defineProperties(scroll, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 }, scrollTop: { configurable: true, writable: true, value: 100 } })
  fireEvent.scroll(scroll)
  scrollIntoView.mockClear()
  act(() => observers.forEach((callback) => callback()))
  expect(scrollIntoView).not.toHaveBeenCalled()
})

it('names the answer detail toggle by its visible mode, describes what it hides separately and cycles all three accessible mode names', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  const { useUiStore } = await import('@/app/uiStore')
  onTestFinished(() => { useUiStore.setState({ answerDetails: {} }) })
  render(view([question, answer]))
  const toggle = screen.getByRole('button', { name: '코드·쉘 실행 제외' })
  expect(toggle).toHaveAttribute('data-answer-detail', 'brief')
  expect(toggle).toHaveAccessibleDescription(/도구·코드 헤더/)
  await userEvent.click(toggle)
  expect(toggle).toHaveAccessibleName('답변만')
  await userEvent.click(toggle)
  expect(toggle).toHaveAccessibleName('도구·코드까지 전체')
  await userEvent.click(toggle)
  expect(toggle).toHaveAccessibleName('코드·쉘 실행 제외')
})


it('offers choices on the latest reply only, hides them after any next user message and during a pending reply', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  const client = new QueryClient()
  const reply: Message = { ...answer, status: 'done', error: undefined, content: '1. 요약\n2. 상세' }
  const latest = { ...reply, id: 'latest' }
  const view = (messages: Message[], waitingSince?: number) => <QueryClientProvider client={client}><TooltipProvider><ChatMessages messages={messages} waitingSince={waitingSince} actions={() => ({ onChoose: () => {} })} /></TooltipProvider></QueryClientProvider>
  const { rerender } = render(view([question, reply, latest]))
  expect(screen.getAllByRole('group', { name: '선택지' })).toHaveLength(1)
  expect(screen.getByRole('group', { name: '선택지' }).closest('[data-message-id]')).toHaveAttribute('data-message-id', 'latest')
  rerender(view([question, reply, { ...question, id: 'next' }]))
  expect(screen.queryByRole('group', { name: '선택지' })).not.toBeInTheDocument()
  rerender(view([question, reply, { ...question, id: 'discussion', kind: 'discussion' }]))
  expect(screen.queryByRole('group', { name: '선택지' })).not.toBeInTheDocument()
  rerender(view([question, reply], Date.now()))
  expect(screen.queryByRole('group', { name: '선택지' })).not.toBeInTheDocument()
})
