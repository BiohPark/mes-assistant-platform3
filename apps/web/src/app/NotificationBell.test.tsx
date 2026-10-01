import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { NotificationBell } from './NotificationBell'

afterEach(() => vi.unstubAllGlobals())

it('읽지 않은 알림을 표시하고 클릭하면 읽음 처리한다', async () => {
  let unread = 1
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/notifications/unread-count') return jsonResponse(200, { count: unread })
    if (url === '/api/notifications') return jsonResponse(200, [{ id: 'n1', userId: 'u1', title: '새 대화 업무가 배정되었습니다', body: 'WK-1', link: '/c/t1', at: new Date().toISOString(), read: unread === 0 }])
    if (url === '/api/notifications/n1/read' && init?.method === 'PATCH') { unread = 0; return jsonResponse(200) }
    return jsonResponse(404)
  })
  vi.stubGlobal('fetch', fetchMock)
  renderWithProviders(<NotificationBell />)
  await userEvent.click(await screen.findByRole('button', { name: '알림 1건 미읽음' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /새 대화 업무가 배정되었습니다/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: /^알림$/ })).toBeInTheDocument())
  expect(fetchMock).toHaveBeenCalledWith('/api/notifications/n1/read', expect.objectContaining({ method: 'PATCH' }))
})
