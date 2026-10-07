import { screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import { MeContext } from '@/app/auth'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { NotesPanel } from './NotesPanel'

afterEach(() => vi.unstubAllGlobals())

it('shows another author’s note delete action to a system owner', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => jsonResponse(200, url === '/api/tasks/t/notes'
    ? [{ id: 'n', taskId: 't', authorId: 'author', content: '검토', createdAt: '2026-01-01T00:00:00.000Z', attachmentIds: [] }]
    : url === '/api/tasks/t/candidates' ? { files: [], conversations: [] } : [])))
  const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-01-01T00:00:00.000Z' } satisfies Task
  renderWithProviders(<MeContext value={{ id: 'so', name: 'SO', role: '', roles: ['system_owner'], theme: 'system' as const, locale: 'ko' as const }}><NotesPanel task={task} /></MeContext>)
  expect(await screen.findByText('검토')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument()
})
