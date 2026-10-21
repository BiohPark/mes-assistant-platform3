import { fireEvent, screen, waitFor } from '@testing-library/react'
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
  renderWithProviders(<MeContext value={{ id: 'so', name: 'SO', role: '', email: null, emailIsDefault: false, roles: ['system_owner'], theme: 'system' as const, locale: 'ko' as const }}><NotesPanel task={task} /></MeContext>)
  expect(await screen.findByText('검토')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument()
})

it('lists attachable files as checkboxes named by file and version', async () => {
  const file = { id: 'f1', taskId: 't', name: 'evidence.txt', version: 1, size: 3, mime: 'text/plain', storageKey: 'k', uploadedBy: 'u', uploadedAt: '2026-01-01T00:00:00.000Z', isOutput: false }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => jsonResponse(200, url === '/api/tasks/t/files' ? [file]
    : url === '/api/tasks/t/candidates' ? { files: [], conversations: [] } : [])))
  const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-01-01T00:00:00.000Z' } satisfies Task
  renderWithProviders(<MeContext value={{ id: 'u', name: '나', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><NotesPanel task={task} /></MeContext>)
  const box = await screen.findByRole('checkbox', { name: /evidence\.txt v1/ })
  expect(box).not.toBeChecked()
  expect(screen.getByRole('button', { name: '메모 추가' })).toBeDisabled()
  fireEvent.click(box)
  expect(box).toBeChecked()
  expect(screen.getByRole('button', { name: '메모 추가' })).toBeEnabled()
})

function noteTask(id: string): Task {
  return { id, code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-01-01T00:00:00.000Z' }
}
const member = { id: 'u', name: '나', role: '', email: null, emailIsDefault: false, roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }

it('locks the draft and attachments while a note is saving, then clears it on success', async () => {
  const file = { id: 'f1', taskId: 'n1', name: 'evidence.txt', version: 1, size: 3, mime: 'text/plain', storageKey: 'k', uploadedBy: 'u', uploadedAt: '2026-01-01T00:00:00.000Z', isOutput: false }
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => init?.method === 'POST'
    ? new Promise<Response>((resolve) => { finish = resolve })
    : Promise.resolve(jsonResponse(200, url === '/api/tasks/n1/files' ? [file] : url === '/api/tasks/n1/candidates' ? { files: [], conversations: [] } : []))))
  renderWithProviders(<MeContext value={member}><NotesPanel task={noteTask('n1')} /></MeContext>)
  const body = screen.getByRole('textbox', { name: '메모 본문' })
  fireEvent.change(body, { target: { value: '느린 저장' } })
  const box = await screen.findByRole('checkbox', { name: /evidence\.txt v1/ })
  fireEvent.click(screen.getByRole('button', { name: '메모 추가' }))
  expect(await screen.findByRole('button', { name: '저장 중…' })).toBeDisabled()
  expect(body).toHaveAttribute('readonly')
  expect(box).toBeDisabled()
  finish(jsonResponse(201, { id: 'n', taskId: 'n1', authorId: 'u', content: '느린 저장', createdAt: '2026-01-01T00:00:00.000Z', attachmentIds: [] }))
  await waitFor(() => expect(body).toHaveValue(''))
  expect(body).not.toHaveAttribute('readonly')
})

it('keeps the draft and unlocks it when saving a note fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => init?.method === 'POST'
    ? jsonResponse(500, { message: 'fail' })
    : jsonResponse(200, url === '/api/tasks/n2/candidates' ? { files: [], conversations: [] } : [])))
  renderWithProviders(<MeContext value={member}><NotesPanel task={noteTask('n2')} /></MeContext>)
  const body = screen.getByRole('textbox', { name: '메모 본문' })
  fireEvent.change(body, { target: { value: '남겨야 할 메모' } })
  fireEvent.click(screen.getByRole('button', { name: '메모 추가' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '메모 추가' })).toBeEnabled())
  expect(body).toHaveValue('남겨야 할 메모')
  expect(body).not.toHaveAttribute('readonly')
})
