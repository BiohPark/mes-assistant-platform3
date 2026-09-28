import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TaskPage } from './TaskPage'

afterEach(() => vi.unstubAllGlobals())

it('does not send the draft handoff twice if the task screen remounts during the request', async () => {
  let sends = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/tasks/t') return new Response(JSON.stringify({ id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '도우미 대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' }), { status: 200 })
    if (url === '/api/assistants') return new Response(JSON.stringify([{ id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', revision: 0 }]), { status: 200 })
    if (url === '/api/threads/h/messages' && init?.method === 'POST') { sends++; return new Promise<Response>(() => undefined) }
    return new Response('[]', { status: 200 })
  }))
  const view = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><TooltipProvider><MemoryRouter initialEntries={[{ pathname: '/c/t', state: { autoSend: '팀 의견' } }]}><Routes><Route path="/c/:taskId" element={<TaskPage />} /></Routes></MemoryRouter></TooltipProvider></MeContext></QueryClientProvider>)
  const first = view()
  await waitFor(() => expect(sends).toBe(1))
  first.unmount()
  const second = view()
  await screen.findByText('WK-2026-0001')
  await waitFor(() => expect(sends).toBe(1))
  second.unmount()
})
