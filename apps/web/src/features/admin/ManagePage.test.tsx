import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import type { Assistant } from '@mes/contracts'
import { ThemeProvider } from 'next-themes'
import { ProfileProvider } from '@/app/profile'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { ManagePage } from './ManagePage'

const assistant = { id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'assistant_level1:SDLC', level2CodeId: 'assistant_level2:분석',
  summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'owner', status: 'open', usageExample: '', color: '#2563eb',
  checklistTemplate: [], createdBy: 'owner', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', revision: 0, imageId: 'image' } as Assistant
let assistantRows: Assistant[] = [assistant]
vi.mock('@/app/hooks', () => ({ useAssistants: () => assistantRows, useUsers: () => [] }))
afterEach(() => { vi.unstubAllGlobals(); assistantRows = [assistant] })

it('enables order editing after assistants load and shows every card', () => {
  assistantRows = []
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const page = () => <QueryClientProvider client={client}><MemoryRouter><ThemeProvider attribute="class" defaultTheme="system" storageKey="mes-theme" disableTransitionOnChange><ProfileProvider><MeContext value={{ id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><ManagePage /></TooltipProvider></MeContext></ProfileProvider></ThemeProvider></MemoryRouter></QueryClientProvider>
  const { container, rerender } = render(page())
  expect(screen.getByRole('button', { name: '순서 편집' })).toBeDisabled()

  assistantRows = [assistant, { ...assistant, id: 'b', name: '두 번째 도우미', order: 2 }]
  rerender(page())
  const editOrder = screen.getByRole('button', { name: '순서 편집' })
  expect(editOrder).toBeEnabled()
  fireEvent.click(editOrder)
  expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(assistantRows.length)
})

it('removes an image without submitting unsaved assistant edits', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/codes?includeInactive=true') return jsonResponse(200, [])
    return jsonResponse(200, {})
  }))
  renderWithProviders(<MeContext value={{ id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><ManagePage /></TooltipProvider></MeContext>)
  fireEvent.click(screen.getByRole('button', { name: '편집' }))
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '저장하지 않은 이름' } })
  expect(screen.getByRole('button', { name: '이미지 제거' })).toHaveAttribute('type', 'button')
  fireEvent.click(screen.getByRole('button', { name: '이미지 제거' }))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/assistants/a/image' && init?.method === 'DELETE')).toBe(true))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(calls.some(([url, init]) => url === '/api/assistants/a' && init?.method === 'PATCH')).toBe(false)
  expect(screen.getByRole('dialog', { name: '에이전트 편집' })).toBeInTheDocument()
})
