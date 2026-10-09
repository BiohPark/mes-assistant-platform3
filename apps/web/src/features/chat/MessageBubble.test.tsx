import { screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { Message } from '@mes/domain'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MessageBubble } from './MessageBubble'

it('labels an assistant reply as assistant when it offers output saving', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  const message = { id: 'm', threadId: 'h', seq: 1, role: 'assistant', content: '# answer', status: 'done', createdAt: '2026-01-01T00:00:00.000Z', attachmentIds: [] } as Message
  renderWithProviders(<TooltipProvider><MessageBubble message={message} onSaveAsOutput={() => undefined} /></TooltipProvider>)
  expect(screen.getByText('assistant')).toBeInTheDocument()
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
