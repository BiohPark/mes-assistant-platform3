import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { ChecklistPanel } from './ChecklistPanel'

afterEach(() => vi.unstubAllGlobals())

const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-01-01T00:00:00.000Z' } satisfies Task

it('keeps the add button available after typing a checklist item', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') calls.push(url)
    return jsonResponse(200, [])
  }))
  renderWithProviders(<ChecklistPanel task={task} />)
  const panel = screen.getByTestId('checklist-panel')
  fireEvent.change(screen.getByRole('textbox', { name: '체크리스트 새 항목' }), { target: { value: '근거 확인' } })
  const button = panel.querySelector('button[type="submit"]')!
  expect(button).toHaveAccessibleName('추가')
  expect(button).toBeEnabled()
  fireEvent.click(button)
  expect(calls).toContain('/api/tasks/t/checklist')
})

it('clears on submit, locks the form, and keeps the next item after the request finishes', async () => {
  let finish!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { finish = resolve })
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => init?.method === 'POST' && url === '/api/tasks/t/checklist' ? pending : Promise.resolve(jsonResponse(200, []))))
  renderWithProviders(<ChecklistPanel task={task} />)
  const input = screen.getByRole('textbox', { name: '체크리스트 새 항목' })
  const button = screen.getByRole('button', { name: '추가' })
  fireEvent.change(input, { target: { value: '근거 확인' } })
  fireEvent.click(button)
  expect(input).toHaveValue('')
  expect(input).toBeDisabled()
  expect(button).toBeDisabled()

  finish(jsonResponse(200, []))
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, { target: { value: '승인 확인' } })
  expect(input).toHaveValue('승인 확인')
  expect(button).toBeEnabled()
})

it('restores the submitted item when adding fails', async () => {
  let fail!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { fail = resolve })
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => init?.method === 'POST' && url === '/api/tasks/t/checklist' ? pending : Promise.resolve(jsonResponse(200, []))))
  renderWithProviders(<ChecklistPanel task={task} />)
  const input = screen.getByRole('textbox', { name: '체크리스트 새 항목' })
  fireEvent.change(input, { target: { value: '근거 확인' } })
  fireEvent.click(screen.getByRole('button', { name: '추가' }))
  expect(input).toHaveValue('')
  expect(input).toBeDisabled()
  fail(jsonResponse(500, { message: '추가 실패' }))
  await waitFor(() => expect(input).toHaveValue('근거 확인'))
  expect(input).toBeEnabled()
})
