import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Message } from '@mes/domain'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ChatMessages } from './ChatMessages'

const question: Message = { id: 'q', threadId: 'h', role: 'user', content: '첫 질문', status: 'done', attachmentIds: [], createdAt: '2026-01-01T00:00:00Z', requestId: 'r' }
const answer: Message = { ...question, id: 'a', role: 'assistant', content: '답변', status: 'error', error: '실패' }
afterEach(() => vi.unstubAllGlobals())
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
  const jump = screen.getByRole('button', { name: '새 답변으로' })
  jump.focus()
  await userEvent.setup().keyboard('{Enter}')
  expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'instant', block: 'end' }))
  expect(screen.queryByRole('button', { name: '새 답변으로' })).not.toBeInTheDocument()
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
