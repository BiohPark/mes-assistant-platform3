import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { TaskCompleteDialog } from './TaskCompleteDialog'

const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '제목', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [],
  checklist: [{ id: 'c1', label: '승인 확인', required: true, checked: false }, { id: 'c2', label: '참고', required: false, checked: false }], inputs: [], outputFileIds: [], threadId: 'h',
  createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' } satisfies Task
afterEach(() => vi.unstubAllGlobals())

function mount(value: Task) {
  const posts: Array<{ url: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') posts.push({ url, body: JSON.parse(String(init.body)) })
    if (url === '/api/tasks/t/complete/preview') return jsonResponse(200, { content: '# 리포트' })
    if (url === '/api/tasks/t/complete') return jsonResponse(200, { ...value, status: 'done' })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TaskCompleteDialog task={value} open onOpenChange={() => undefined} />)
  return posts
}

it('필수 체크 항목이 미완료면 완료 사유를 받아야 완료 처리할 수 있고 사유를 서버에 보낸다', async () => {
  const posts = mount(task)
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByText('# 리포트')
  const reason = within(dialog).getByRole('textbox', { name: '완료 사유' })
  expect(within(dialog).getByRole('button', { name: '완료 처리' })).toBeDisabled()
  await userEvent.type(reason, ' 담당자 구두 승인 ')
  expect(within(dialog).getByRole('button', { name: '완료 처리' })).toBeEnabled()
  await userEvent.click(within(dialog).getByRole('button', { name: '완료 처리' }))
  await waitFor(() => expect(posts.find((post) => post.url === '/api/tasks/t/complete')?.body).toEqual({ reason: '담당자 구두 승인' }))
})

it('필수 항목이 모두 완료되면 사유 입력 없이 완료 처리한다', async () => {
  const posts = mount({ ...task, checklist: [{ id: 'c1', label: '승인 확인', required: true, checked: true }] })
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByText('# 리포트')
  expect(within(dialog).queryByRole('textbox', { name: '완료 사유' })).not.toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: '완료 처리' }))
  await waitFor(() => expect(posts.find((post) => post.url === '/api/tasks/t/complete')?.body).toEqual({}))
})
