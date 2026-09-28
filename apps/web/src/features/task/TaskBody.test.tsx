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
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><TooltipProvider><TaskBody task={task} assistant={{ id: 'a', name: '도우미' } as Assistant} /></TooltipProvider></MeContext>)
  const mobileTabs = within(screen.getByRole('tablist', { name: '대화 화면 탭' }))
  fireEvent.click(mobileTabs.getByRole('tab', { name: '자료' }))
  expect(screen.getByText('자료는 후속 단계에서 사용할 수 있습니다.')).toBeInTheDocument()
  fireEvent.click(mobileTabs.getByRole('tab', { name: '이력' }))
  expect(await screen.findByText('사유: 추가 확인')).toBeInTheDocument()
})
