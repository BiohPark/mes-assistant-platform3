import { fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { HomePage } from './HomePage'

afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem('mes-locale') })

it('opens a shared tag filter in the kanban and shows the matching conversation', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/assistants') return jsonResponse(200, [{ id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', revision: 0 }])
    if (url === '/api/tasks') return jsonResponse(200, [{ id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '태그 대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['공유'], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' }])
    return jsonResponse(200, [])
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><HomePage /></TooltipProvider></MeContext>, { route: '/?view=kanban&tag=%EA%B3%B5%EC%9C%A0' })
  expect(await screen.findByRole('link', { name: /WK-2026-0001.*태그 대화/ })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '전체 대화 칸반' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(screen.getByRole('tab', { name: '에이전트 카드' }))
  expect(await screen.findByRole('link', { name: /새 대화/ })).toBeInTheDocument()
})

it('keeps the conversation code on one line and shows the column count beside the avatar', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/assistants') return jsonResponse(200, [{ id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', revision: 0 }])
    if (url === '/api/tasks') return jsonResponse(200, [{ id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' }])
    return jsonResponse(200, [])
  }))
  localStorage.setItem('mes-locale', 'en')
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'en' as const }}><TooltipProvider><HomePage /></TooltipProvider></MeContext>, { route: '/?view=kanban' })
  const card = (await screen.findByRole('link', { name: /WK-2026-0001/ })).parentElement!
  const code = screen.getByText('WK-2026-0001')
  expect(code).toHaveClass('whitespace-nowrap', 'shrink-0')
  expect(code.parentElement!.lastElementChild).toHaveClass('truncate')
  expect(code.parentElement!.lastElementChild).toHaveTextContent(/ago/)
  expect(card).toBeInTheDocument()
  const jump = screen.getByTitle('도우미 (1)')
  const count = jump.querySelector('span:last-child')!
  expect(count).toHaveTextContent('1')
  expect(count).not.toHaveClass('absolute')
})

const aiAssistant = { id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', revision: 0 }
const aiTask = (id: string, code: string, aiRequest: unknown) => ({ id, code, assistantId: 'a', title: `대화 ${code}`, titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], threadId: `h-${id}`, createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z', aiRequest })
function renderAiKanban(route = '/?view=kanban') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/assistants') return jsonResponse(200, [aiAssistant])
    if (url === '/api/tasks') return jsonResponse(200, [
      aiTask('t1', 'WK-2026-0001', { status: 'streaming', phase: '파일 올리는 중 1/2', updatedAt: '2026-10-13T00:00:00.000Z' }),
      aiTask('t2', 'WK-2026-0002', { status: 'failed', updatedAt: '2026-10-13T00:00:00.000Z' }),
      aiTask('t3', 'WK-2026-0003', null),
      aiTask('t4', 'WK-2026-0004', { status: 'interrupted', updatedAt: '2026-10-13T00:00:00.000Z' }),
    ])
    return jsonResponse(200, [])
  }))
  return renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><HomePage /></TooltipProvider></MeContext>, { route })
}

it('shows an AI chip beside the task status: pulsing dot while responding (static under reduced motion), icon for failed and interrupted', async () => {
  renderAiKanban()
  const card1 = (await screen.findByRole('link', { name: /WK-2026-0001/ })).parentElement!
  const responding = card1.querySelector('[data-ai-status="responding"]')!
  expect(responding).toHaveTextContent('AI 응답 중')
  expect(responding).toHaveAttribute('title', '파일 올리는 중 1/2')
  expect(responding.querySelector('[data-pulse]')).toHaveClass('motion-safe:animate-pulse')
  expect(responding.previousElementSibling).toHaveTextContent('진행 중')
  const card2 = screen.getByRole('link', { name: /WK-2026-0002/ }).parentElement!
  const failed = card2.querySelector('[data-ai-status="failed"]')!
  expect(failed).toHaveTextContent('AI 실패')
  expect(failed.querySelector('svg')).not.toBeNull()
  const card3 = screen.getByRole('link', { name: /WK-2026-0003/ }).parentElement!
  expect(card3.querySelector('[data-ai-status]')).toBeNull()
  const card4 = screen.getByRole('link', { name: /WK-2026-0004/ }).parentElement!
  expect(card4.querySelector('[data-ai-status="interrupted"]')).toHaveTextContent('AI 중단')
})

it('filters the kanban by AI state through the URL and clears it with the other filters', async () => {
  renderAiKanban('/?view=kanban&ai=failed')
  expect(await screen.findByRole('link', { name: /WK-2026-0002/ })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /WK-2026-0004/ })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /WK-2026-0001/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /WK-2026-0003/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'AI 실패' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('선택됨 1')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'AI 응답 중' }))
  expect(await screen.findByRole('link', { name: /WK-2026-0001/ })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /WK-2026-0002/ })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /WK-2026-0003/ })).not.toBeInTheDocument()
  expect(screen.getByText('선택됨 2')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '초기화' }))
  expect(await screen.findByRole('link', { name: /WK-2026-0003/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'AI 실패' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.queryByRole('button', { name: '초기화' })).not.toBeInTheDocument()
})
