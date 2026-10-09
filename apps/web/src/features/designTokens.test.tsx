import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Assistant } from '@mes/contracts'
import type { Task } from '@mes/domain'
import type { SrDetail } from '@/api/sr'
import { MeContext } from '@/app/auth'
import { useUiStore } from '@/app/uiStore'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { AssistantCardBody } from './home/AssistantCard'
import { ConversationCard } from './home/ConversationCard'
import { SrConvertSheet } from './sr/SrConvertSheet'
import { SystemAssistantDrawer } from './system-assistant/SystemAssistantDrawer'

afterEach(() => {
  act(() => useUiStore.getState().setAssistantOpen(false))
  vi.unstubAllGlobals()
})

const task: Task = {
  id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'ai', summary: '',
  status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [],
  checklist: [], inputs: [], outputFileIds: [], dueDate: '2000-01-01',
  createdAt: '2026-10-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-10-01T00:00:00.000Z',
}

it('shows AI titles and overdue conversation metadata with semantic tones', () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  const { container } = renderWithProviders(<TooltipProvider><ConversationCard task={task} onTagClick={() => undefined} /></TooltipProvider>)
  expect(container.querySelector('svg.lucide-sparkles')).toHaveClass('text-tone-violet-fg')
  expect(container.querySelector('svg.lucide-calendar-clock')?.parentElement).toHaveClass('text-tone-danger-fg')
  expect(screen.getByRole('link')).toHaveAttribute('href', '/c/t')
})

it('shows overdue assistant counts with a danger foreground', () => {
  const assistant: Assistant = {
    id: 'a', name: '도우미', level1: '업무', level2: '자료', level1CodeId: 'l1', level2CodeId: 'l2',
    summary: '', order: 0, modelId: 'model', expectedInputs: [], expectedOutputs: [], ownerId: 'u',
    status: 'open', usageExample: '', color: 'var(--primary)', checklistTemplate: [],
    createdBy: 'u', createdAt: '2026-10-01', updatedAt: '2026-10-01', revision: 1,
  }
  renderWithProviders(<TooltipProvider><AssistantCardBody row={{ assistant, activeCount: 3, overdueCount: 2, doneCount: 1 }} /></TooltipProvider>)
  expect(screen.getByText(/지연 2/)).toHaveClass('text-tone-danger-fg')
})

it('uses an opaque violet tone for SR proposals while leaving edits unapplied', async () => {
  const sr: SrDetail = {
    id: 'sr', code: 'SR-2026-0001', requesterId: 'u', title: '원래 제목', titleSource: 'manual', body: '원래 본문',
    status: 'submitted', attachmentIds: [], candidateAttachmentIds: [], threadId: 'thread',
    results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01',
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/service-requests/sr/refine'
    ? jsonResponse(200, { title: '제안 제목', body: '제안 본문' }) : jsonResponse(404)))
  renderWithProviders(<SrConvertSheet sr={sr} open onOpenChange={() => undefined} onSaved={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: 'AI로 다듬기' }))
  const proposal = await screen.findByRole('region', { name: 'AI 제안 (적용 전)' })
  expect(proposal).toHaveClass('border-tone-violet-fg/40', 'bg-tone-violet-bg')
  expect(proposal.className).not.toMatch(/bg-[\w-]+\/|dark:/)
  expect(screen.getByRole('textbox', { name: 'SR 제목' })).toHaveValue('원래 제목')
})

it('shows successfully applied system assistant proposals with a success tone', async () => {
  const writes: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/system-assistant/model') return jsonResponse(200, { mode: 'mock', model: 'mock' })
    if (url === '/api/system-assistant/messages') return jsonResponse(200, {
      text: '확인하세요', toolCalls: [{ id: 'tag', name: 'add_tag', arguments: '{"taskCode":"WK-2026-0001","tag":"release"}' }],
    })
    if (url === '/api/tasks') return jsonResponse(200, [task])
    if (url === '/api/tasks/t/tags/release' && init?.method === 'PUT') { writes.push(url); return jsonResponse(204) }
    return jsonResponse(404)
  }))
  useUiStore.getState().setAssistantOpen(true)
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SystemAssistantDrawer /></MeContext>)
  fireEvent.click(screen.getByRole('button', { name: /FDS 작성 도우미로/ }))
  fireEvent.click(await screen.findByRole('button', { name: '적용' }))
  await waitFor(() => expect(writes).toEqual(['/api/tasks/t/tags/release']))
  expect(await screen.findByText('WK-2026-0001에 release 태그를 붙였습니다.')).toHaveClass('text-tone-success-fg')
})
