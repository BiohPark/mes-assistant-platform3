import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { Message } from '@mes/domain'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MessageBubble } from './MessageBubble'

const { copy, copyError, copySuccess } = vi.hoisted(() => ({ copy: vi.fn(), copyError: vi.fn(), copySuccess: vi.fn() }))
vi.mock('@/lib/clipboard', () => ({ copyText: copy }))
vi.mock('sonner', () => ({ toast: { error: copyError, success: copySuccess } }))
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); copy.mockReset(); copyError.mockClear(); copySuccess.mockClear() })

it.each([
  { role: 'user', kind: undefined, intake: false, tone: 'primary', background: 'bg-primary' },
  { role: 'user', kind: 'discussion', intake: false, tone: 'warning', background: 'bg-tone-warning-bg' },
  { role: 'assistant', kind: undefined, intake: false, tone: 'card', background: 'bg-card' },
  { role: 'assistant', kind: 'discussion', intake: false, tone: 'card', background: 'bg-card' },
  { role: 'user', kind: 'discussion', intake: true, tone: 'primary', background: 'bg-primary' },
] as const)('matches Markdown to the $tone bubble (role=$role, kind=$kind, intake=$intake)', ({ role, kind, intake, tone, background }) => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  const message = { id: 'tone', threadId: 'h', role, kind, content: 'https://example.com', status: 'done', createdAt: '2026-01-01', attachmentIds: [] } as Message
  const { container } = renderWithProviders(<TooltipProvider><MessageBubble message={message} intake={intake} /></TooltipProvider>)
  const markdown = container.querySelector('.md-body')
  expect(markdown).toHaveAttribute('data-tone', tone)
  expect(markdown?.parentElement).toHaveClass(background)
  expect(screen.getByRole('link')).toHaveAttribute('target', '_blank')
  expect(screen.getByRole('link')).toHaveAttribute('rel', 'noreferrer')
})

it('labels an assistant reply as assistant when it offers output saving', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  const message = { id: 'm', threadId: 'h', seq: 1, role: 'assistant', content: '# answer', status: 'done', createdAt: '2026-01-01T00:00:00.000Z', attachmentIds: [] } as Message
  renderWithProviders(<TooltipProvider><MessageBubble message={message} onSaveAsOutput={() => undefined} /></TooltipProvider>)
  expect(screen.getByText('에이전트')).toBeInTheDocument()
  expect(screen.queryByText('팀 의견 · AI 미전송')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '산출물로 저장' })).toBeInTheDocument()
})

it('shows attached file names below a team message and marks deleted files', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/f1') ? jsonResponse(200, { id: 'f1', name: 'note.txt' }) : jsonResponse(404, {})))
  const message = { id: 'm2', threadId: 'h', seq: 2, role: 'user', kind: 'discussion', content: '검토', status: 'done', createdAt: '2026-01-01T00:00:00.000Z', attachmentIds: ['f1', 'gone'] } as Message
  renderWithProviders(<TooltipProvider><MessageBubble message={message} /></TooltipProvider>)
  expect(await screen.findByText('note.txt')).toBeInTheDocument()
  expect(await screen.findByText(/삭제된 파일/)).toBeInTheDocument()
})

it('distinguishes forbidden, gone and unknown attachment failures', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => jsonResponse(url.endsWith('/f403') ? 403 : url.endsWith('/f410') ? 410 : 500, {})))
  const message = { id: 'm3', threadId: 'h', seq: 3, role: 'user', content: '검토', status: 'done', createdAt: '2026-01-01T00:00:00.000Z', attachmentIds: ['f403', 'f410', 'f500'] } as Message
  renderWithProviders(<TooltipProvider><MessageBubble message={message} /></TooltipProvider>)
  expect(await screen.findByText(/열람 권한 없음/)).toBeInTheDocument()
  expect(await screen.findByText(/삭제된 파일/)).toBeInTheDocument()
  expect(await screen.findByText(/파일 확인 실패/)).toBeInTheDocument()
})

it('styles the team-discussion bubble with semantic tokens only', () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  const message = { id: 'm4', threadId: 'h', seq: 4, role: 'user', kind: 'discussion', content: '의견', status: 'done', createdAt: '2026-01-01T00:00:00.000Z', attachmentIds: [] } as Message
  const { container } = renderWithProviders(<TooltipProvider><MessageBubble message={message} /></TooltipProvider>)
  expect(container.innerHTML).not.toMatch(/(?:bg|text|border|fill)-(?:amber|violet|sky)-\d/)
  expect(container.innerHTML).not.toMatch(/bg-[\w-]+\/\d+/)
  expect(container.querySelector('.border-dashed')).toHaveClass('border-tone-warning-fg/40', 'bg-tone-warning-bg')
})

it('opens the existing preview and download from an attachment without changing input selection', async () => {
  const file = { id: 'f1', originTaskId: 't', name: 'note.txt', mime: 'text/plain', size: 4, sha256: 'hash', source: 'upload', isOutput: false, version: 1, uploadedBy: 'u', uploadedAt: '2026-01-01T00:00:00.000Z' }
  const calls: Array<{ url: string; method?: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method })
    if (url === '/api/files/f1') return jsonResponse(200, file)
    if (url === '/api/files/f1/content') return new Response('첨부 본문')
    return jsonResponse(200, [])
  }))
  const create = vi.fn(() => 'blob:download')
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() })
  const linkClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  const message = { id: 'm5', threadId: 'h', seq: 5, role: 'user', content: '첨부 확인', status: 'done', createdAt: '2026-01-01T00:00:00.000Z', attachmentIds: ['f1'] } as Message
  renderWithProviders(<TooltipProvider><MessageBubble message={message} /></TooltipProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'note.txt' }))
  const dialog = await screen.findByRole('dialog', { name: 'note.txt' })
  expect(await within(dialog).findByText('첨부 본문')).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: '다운로드' }))
  await waitFor(() => expect(linkClick).toHaveBeenCalledOnce())
  expect(create).toHaveBeenCalledOnce()
  expect(calls.filter(({ url }) => url === '/api/files/f1')).toHaveLength(1)
  expect(calls.filter(({ url }) => url === '/api/files/f1/content')).toHaveLength(2)
  expect(calls.some(({ url }) => /inputs|candidates/.test(url))).toBe(false)
  expect(calls.every(({ method }) => !method || method === 'GET')).toBe(true)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  linkClick.mockRestore()
})

it('keeps intake attachments as direct download links without materials actions', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { id: 'f1', name: 'note.txt' })))
  const message = { id: 'm6', threadId: 'h', seq: 6, role: 'user', content: '접수', status: 'done', createdAt: '2026-01-01', attachmentIds: ['f1'] } as Message
  renderWithProviders(<TooltipProvider><MessageBubble message={message} intake /></TooltipProvider>)
  expect(await screen.findByRole('link', { name: 'note.txt' })).toHaveAttribute('href', '/api/files/f1/content')
  expect(screen.queryByRole('button', { name: 'note.txt' })).not.toBeInTheDocument()
})

it.each(['Escape', 'close button'] as const)('returns focus to the keyboard attachment opener after closing with %s', async (closeWith) => {
  const user = userEvent.setup()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/content')) return new Response('첨부 본문')
    if (url.startsWith('/api/files/')) return jsonResponse(200, { id: url.split('/').at(-1), name: url.endsWith('/f2') ? 'second.txt' : 'first.txt', mime: 'text/plain' })
    return jsonResponse(200, [])
  }))
  const message = { id: 'focus', threadId: 'h', seq: 7, role: 'user', content: '첨부 확인', status: 'done', createdAt: '2026-01-01', attachmentIds: ['f1', 'f2'] } as Message
  renderWithProviders(<TooltipProvider><MessageBubble message={message} /></TooltipProvider>)
  const opener = await screen.findByRole('button', { name: 'second.txt' })
  for (let i = 0; i < 12 && document.activeElement !== opener; i++) await user.tab()
  expect(opener).toHaveFocus()
  await user.keyboard('{Enter}')
  const dialog = await screen.findByRole('dialog', { name: 'second.txt' })
  await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
  if (closeWith === 'Escape') await user.keyboard('{Escape}')
  else await user.click(within(dialog).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(opener).toHaveFocus())
})


it.each(['user', 'assistant'] as const)('copies raw Markdown from a %s bubble and reports failure', async (role) => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  copy.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  const message = { id: 'copy', threadId: 'h', role, content: '# Title\n\n**bold** [link](https://example.com)', status: 'done', createdAt: '2026-01-01', attachmentIds: [] } as Message
  renderWithProviders(<TooltipProvider><MessageBubble message={message} /></TooltipProvider>)
  const toolbar = screen.getByRole('group', { name: '메시지 동작' })
  const button = within(toolbar).getByRole('button', { name: '복사' })
  fireEvent.click(button)
  await waitFor(() => expect(copySuccess).toHaveBeenCalledWith('메시지를 복사했습니다.'))
  expect(copy).toHaveBeenCalledWith(message.content)
  fireEvent.click(button)
  await waitFor(() => expect(copyError).toHaveBeenCalledWith('복사하지 못했습니다. 다시 시도해 주세요.'))
})

it('opens the mobile actions menu by keyboard and respects disabled reasking', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  const ask = vi.fn()
  const message = { id: 'menu', threadId: 'h', role: 'user', content: '질문', status: 'done', createdAt: '2026-01-01', attachmentIds: [] } as Message
  renderWithProviders(<TooltipProvider><MessageBubble message={message} onAskAgain={ask} askAgainDisabled /></TooltipProvider>)
  const trigger = screen.getByRole('button', { name: '메시지 메뉴' })
  trigger.focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('menuitem', { name: '다시 묻기' })).toHaveAttribute('data-disabled')
  await user.keyboard('{Escape}')
  expect(trigger).toHaveFocus()
  expect(ask).not.toHaveBeenCalled()
})

function reduceMotion() {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia
  onTestFinished(() => { window.matchMedia = original })
}
const thinkingMessage: Message = { id: 'thinking', threadId: 'h', role: 'assistant', content: '', reasoning: '검토 중', status: 'streaming', createdAt: '2026-01-01T00:00:00Z', attachmentIds: [] }
function renderThinking(message = thinkingMessage) {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  const client = new QueryClient()
  const wrapper = ({ children }: { children: import('react').ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return render(<MessageBubble message={message} />, { wrapper })
}

it('keeps streaming reasoning collapsed with a last-lines preview that leaves the accessible name alone, and drops the preview once the answer starts', () => {
  const { container, rerender } = renderThinking({ ...thinkingMessage, reasoning: '첫 줄\n\n둘째 줄\n셋째 줄' })
  const details = container.querySelector('details')!
  const summary = screen.getByText('생각 과정')
  expect(details.open).toBe(false)
  expect(summary).toHaveAttribute('aria-expanded', 'false')
  const preview = container.querySelector('[data-reasoning-preview]')!
  expect(preview).toHaveAttribute('aria-hidden', 'true')
  expect(preview).toHaveTextContent('둘째 줄 셋째 줄')
  expect(preview).not.toHaveTextContent('첫 줄')
  expect(summary).toContainElement(preview as HTMLElement)
  rerender(<MessageBubble message={{ ...thinkingMessage, content: '답변 시작' }} />)
  expect(details.open).toBe(false)
  expect(container.querySelector('[data-reasoning-preview]')).toBeNull()
  expect(container.querySelector('.md-body')).toBeInTheDocument()
})

it('follows opened reasoning only while the reader stays at its bottom', async () => {
  reduceMotion()
  const { container, rerender } = renderThinking()
  await userEvent.setup().click(screen.getByText('생각 과정'))
  expect(container.querySelector('details')?.open).toBe(true)
  const box = container.querySelector<HTMLElement>('details > div')!
  expect(box).toHaveAttribute('aria-live', 'off')
  expect(box).toHaveClass('max-h-64', 'overflow-y-auto', 'scroll-auto')
  Object.defineProperties(box, { scrollHeight: { configurable: true, value: 500 }, clientHeight: { configurable: true, value: 200 } })
  rerender(<MessageBubble message={{ ...thinkingMessage, reasoning: '검토 중\n다음 단계' }} />)
  expect(box.scrollTop).toBe(500)
  box.scrollTop = 100 // 사용자가 위로 올려 읽는다
  fireEvent.scroll(box)
  rerender(<MessageBubble message={{ ...thinkingMessage, reasoning: '검토 중\n다음 단계\n셋째' }} />)
  expect(box.scrollTop).toBe(100)
  box.scrollTop = 300 // 바닥(500-200)으로 돌아오면 다시 따라간다
  fireEvent.scroll(box)
  rerender(<MessageBubble message={{ ...thinkingMessage, reasoning: '검토 중\n다음 단계\n셋째\n넷째' }} />)
  expect(box.scrollTop).toBe(500)
})

it.each(['done', 'error'] as const)('keeps reasoning collapsed without a preview when streaming ends with %s', (status) => {
  const { container, rerender } = renderThinking()
  expect(container.querySelector('details')?.open).toBe(false)
  rerender(<MessageBubble message={{ ...thinkingMessage, status }} />)
  expect(container.querySelector('details')?.open).toBe(false)
  expect(container.querySelector('[data-reasoning-preview]')).toBeNull()
})

it.each(['close', 'open'] as const)('preserves the user choice to %s reasoning across tokens, answer and completion', async (choice) => {
  const user = userEvent.setup()
  const { container, rerender } = renderThinking()
  const summary = screen.getByText('생각 과정')
  summary.focus()
  await user.keyboard('{Enter}')
  if (choice === 'close') await user.keyboard(' ')
  const open = choice === 'open'
  expect(container.querySelector('details')?.open).toBe(open)
  for (const message of [
    { ...thinkingMessage, reasoning: '다음 단계' },
    { ...thinkingMessage, content: '답변 시작' },
    { ...thinkingMessage, content: '답변 완료', status: 'done' as const },
  ]) {
    rerender(<MessageBubble message={message} />)
    expect(container.querySelector('details')?.open).toBe(open)
    expect(summary).toHaveAttribute('aria-expanded', String(open))
  }
})

it('keeps completed reasoning initially collapsed and allows reopening it', async () => {
  const { container } = renderThinking({ ...thinkingMessage, status: 'done', content: '답변' })
  expect(container.querySelector('details')?.open).toBe(false)
  await userEvent.setup().click(screen.getByText('생각 과정'))
  expect(container.querySelector('details')?.open).toBe(true)
})

it('shows the progress line with a live dot, last response age, and the limit countdown once quiet', () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  const client = new QueryClient()
  const view = (progress: import('react').ComponentProps<typeof MessageBubble>['progress']) => <QueryClientProvider client={client}><MessageBubble message={thinkingMessage} progress={progress} /></QueryClientProvider>
  const { container, rerender } = render(view({ phase: '생각 중', elapsed: 12, lastSignal: 3 }))
  const header = screen.getByRole('status').parentElement!
  expect(screen.getByRole('status')).toHaveTextContent('생각 중')
  expect(within(header).getByRole('timer')).toHaveTextContent('12초 경과')
  expect(header).toHaveTextContent('마지막 응답 3초 전')
  const dot = container.querySelector('[data-live-dot]')!
  expect(dot).toHaveAttribute('aria-hidden', 'true')
  expect(dot).toHaveClass('motion-safe:animate-pulse')
  rerender(view({ phase: '생각 중', elapsed: 40, lastSignal: 25, quiet: true, limitLeft: 275 }))
  expect(screen.getByRole('status')).toHaveTextContent('응답 대기 중')
  expect(header).toHaveTextContent('제한까지 4분 35초')
  expect(header).not.toHaveTextContent('마지막 응답')
  expect(container.querySelector('[data-live-dot]')).not.toHaveClass('motion-safe:animate-pulse')
  rerender(view({ phase: '생각 중', elapsed: 300, quiet: true, limitLeft: 9 }))
  expect(header).toHaveTextContent('제한까지 9초')
  expect(screen.getAllByRole('status')).toHaveLength(1)
  expect(screen.getAllByRole('timer')).toHaveLength(1)
})

it('types out a streaming answer for display while copy keeps the raw text', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  copy.mockResolvedValue(true)
  const client = new QueryClient()
  const streaming: Message = { ...thinkingMessage, reasoning: undefined, content: '시작' }
  const view = (message: Message) => <QueryClientProvider client={client}><MessageBubble message={message} /></QueryClientProvider>
  const { container, rerender } = render(view(streaming))
  act(() => vi.advanceTimersByTime(1000))
  const full = `시작${'가'.repeat(200)}`
  rerender(view({ ...streaming, content: full }))
  const body = () => container.querySelector('.md-body')!.textContent!
  expect(body().length).toBeLessThan(full.length)
  fireEvent.click(within(screen.getByRole('group', { name: '메시지 동작' })).getByRole('button', { name: '복사' }))
  expect(copy).toHaveBeenCalledWith(full)
  rerender(view({ ...streaming, content: full, status: 'done' }))
  expect(body()).toBe(full)
  vi.useRealTimers()
})

it.each(['', '   '])('omits an empty assistant answer bubble for %j', (content) => {
  const { container } = renderThinking({ ...thinkingMessage, content })
  expect(container.querySelector('.md-body')).not.toBeInTheDocument()
  expect(screen.queryByText('응답 중…')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('생각 중')
  expect(screen.getByRole('status').parentElement).toHaveTextContent('에이전트')
})

it('copies fenced code without controls or inline code and preserves raw Markdown copying', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  copy.mockResolvedValue(true)
  const content = 'inline `x`\n\n```ts\nconst x = 1\n```'
  renderWithProviders(<MessageBubble message={{ ...thinkingMessage, content, status: 'done' }} assistantName="Named agent" />)
  expect(screen.getByText('Named agent')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: '코드 복사' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '코드 복사' }))
  await waitFor(() => expect(copy).toHaveBeenCalledWith('const x = 1\n'))
  fireEvent.click(within(screen.getByRole('group', { name: '메시지 동작' })).getByRole('button', { name: '복사' }))
  await waitFor(() => expect(copy).toHaveBeenCalledWith(content))
})

it('shows reasoning text as received from the model', () => {
  const { container } = renderThinking({ ...thinkingMessage, reasoning: 'original reasoning' })
  expect(container.querySelector('[data-reasoning-preview]')).toHaveTextContent('original reasoning')
  expect(container.querySelector('details > div')).toHaveTextContent('original reasoning')
})

it('S14: 답변은 넓게(모바일 전체 폭), 내 질문은 모바일 90%·데스크톱 80%까지 쓴다', () => {
  const at = '2026-10-15T00:00:00.000Z'
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  const { container } = renderWithProviders(<TooltipProvider><MessageBubble message={{ id: 'a', threadId: 'h', seq: 1, role: 'assistant', content: '답변', status: 'done', createdAt: at, attachmentIds: [] } as Message} />
    <MessageBubble message={{ id: 'u', threadId: 'h', seq: 2, role: 'user', content: '질문', status: 'done', createdAt: at, attachmentIds: [] } as Message} /></TooltipProvider>)
  const [answer, question] = Array.from(container.querySelectorAll('[data-message-id] > div.flex-col'))
  expect(answer).toHaveClass('max-w-full', 'sm:max-w-[92%]')
  expect(question).toHaveClass('max-w-[90%]', 'sm:max-w-[80%]')
})

it('opens a persisted answer image in the existing file preview and blocks remote/data image loading', async () => {
  const file = { id: 'ai-image', name: 'generated.png', mime: 'image/png', size: 3, source: 'assistant' }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/files/ai-image' ? jsonResponse(200, file) : url.endsWith('/content') ? new Response('png') : jsonResponse(200, [])))
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:preview', revokeObjectURL: vi.fn() })
  const message = { id: 'image-message', threadId: 'h', role: 'assistant', status: 'done', content: '![generated](/api/files/ai-image/content) ![foreign](https://other.test/image.png) ![inline](data:image/png;base64,aGk=)', attachmentIds: [], createdAt: '2026-01-01' } as Message
  renderWithProviders(<TooltipProvider><MessageBubble message={message} /></TooltipProvider>)
  expect(screen.getByRole('img', { name: 'generated' })).toHaveAttribute('src', '/api/files/ai-image/content')
  expect(screen.queryByRole('img', { name: 'foreign' })).not.toBeInTheDocument()
  expect(screen.queryByRole('img', { name: 'inline' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'generated' }))
  expect(await screen.findByRole('dialog', { name: 'generated.png' })).toBeInTheDocument()
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', 'blob:preview'))
})
