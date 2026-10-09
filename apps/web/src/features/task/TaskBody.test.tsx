import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { TaskBody } from './TaskBody'

const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' } satisfies Task
afterEach(() => vi.unstubAllGlobals())

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
  const panel = screen.getByRole('tabpanel')
  expect(panel).toHaveAttribute('id', 'task-panel')
  expect(panel).toHaveAttribute('aria-labelledby', 'task-tab-history')
  expect(history).toHaveAttribute('aria-controls', 'task-panel')

  history.focus()
  fireEvent.keyDown(history, { key: 'ArrowRight' })
  const materials = panelTabs.getByRole('tab', { name: '자료' })
  expect(materials).toHaveAttribute('aria-selected', 'true')
  expect(materials).toHaveFocus()
  expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'task-tab-materials')
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
  expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'task-tab-materials')
  expect(screen.getByRole('region', { name: '대화' })).toBeInTheDocument()
  fireEvent.keyDown(mobileTabs.getByRole('tab', { name: '자료' }), { key: 'Home' })
  expect(chat).toHaveAttribute('aria-selected', 'true')
  expect(chat).toHaveFocus()
})
