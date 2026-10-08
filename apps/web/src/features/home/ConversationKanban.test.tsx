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
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><HomePage /></TooltipProvider></MeContext>, { route: '/?view=kanban&tag=%EA%B3%B5%EC%9C%A0' })
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
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'en' as const }}><TooltipProvider><HomePage /></TooltipProvider></MeContext>, { route: '/?view=kanban' })
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
