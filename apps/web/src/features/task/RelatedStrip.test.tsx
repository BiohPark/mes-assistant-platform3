import { fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { RelatedStrip } from './RelatedStrip'

const base = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '원본', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['첫째', '둘째'], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' } satisfies Task
afterEach(() => vi.unstubAllGlobals())

it('finds conversations sharing either tag and removes the current conversation', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    if (url === '/api/assistants') return jsonResponse(200, [])
    if (url.includes('tag%5B%5D=%EB%91%98%EC%A7%B8')) return jsonResponse(200, [{ ...base, id: 'other', code: 'WK-2026-0002', title: '관련 대화', tags: ['둘째'] }])
    return jsonResponse(200, [base])
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><TooltipProvider><RelatedStrip task={base} /></TooltipProvider></MeContext>)
  const button = await screen.findByText('연결된 대화 1')
  fireEvent.click(button)
  expect(screen.getByRole('link', { name: /WK-2026-0002.*관련 대화/ })).toHaveAttribute('href', '/c/other')
  expect(calls.filter((url) => url.startsWith('/api/tasks?')).length).toBe(2)
})
