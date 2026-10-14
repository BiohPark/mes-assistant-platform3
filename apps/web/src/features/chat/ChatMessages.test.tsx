import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Message } from '@mes/domain'
import { afterEach, expect, it, vi } from 'vitest'
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
  expect(screen.getByRole('status')).toHaveTextContent('생각 중')
  expect(header).toHaveTextContent('에이전트')
  expect(within(header).getByRole('timer')).toHaveTextContent('0초 경과')
  expect(screen.getAllByRole('timer')).toHaveLength(1)
  expect(document.querySelector('[data-message-id="waiting-assistant"] .md-body')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(2000))
  expect(within(header).getByRole('timer')).toHaveTextContent('2초 경과')
  rerender(view({ requestId: 'r', replyId: 'a', text: '', reasoning: '검토', phase: '생각 중', startedAt }))
  expect(screen.getByRole('status')).toHaveTextContent('생각 중')
  expect(screen.getByRole('status').parentElement).toContainElement(screen.getByRole('timer'))
  expect(screen.getByText('검토')).toBeVisible()
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByRole('timer')).toHaveTextContent('3초 경과')
  rerender(view({ requestId: 'r', replyId: 'a', text: '답', phase: '답변 중', startedAt }))
  expect(screen.getByRole('status')).toHaveTextContent('답변 중')
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
  expect(screen.getByRole('status')).toHaveTextContent('Thinking')
  expect(screen.getByText('Processing file 1/2 · sample.txt')).toBeInTheDocument()
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
  expect(container.querySelector('details')?.open).toBe(false)
  rerender(view([question, pending]))
  expect(container.querySelectorAll('[data-message-id="a"]')).toHaveLength(1)
  expect(container.querySelector('details')?.open).toBe(false)
  const header = screen.getByRole('status').parentElement!
  expect(header).toContainElement(screen.getByRole('timer'))
  expect(header).toHaveTextContent('에이전트')
  expect(screen.getAllByRole('status')).toHaveLength(1)
  expect(screen.queryByText('응답 중…')).not.toBeInTheDocument()
  expect(container.querySelectorAll('.md-body')).toHaveLength(1)
  rerender(view([question, pending], '실제 답변', '생각 중'))
  expect(screen.getByRole('status')).toHaveTextContent('답변 중')
  expect(screen.getByText('실제 답변')).toBeInTheDocument()
  expect(container.querySelector('details')?.open).toBe(false)
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
  expect(screen.getByRole('status')).toHaveTextContent('생각 중')
})
