import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MeContext } from '@/app/auth'
import { useLocation } from 'react-router'
import { renderWithProviders } from '@/test/render'
import { ConversationCard } from './ConversationCard'

const oldTask = { id: 't', code: 'WK-2026-0001', title: 'Old conversation', status: 'in_progress', tags: [], inputs: [], ownerId: 'u', assigneeIds: [], lastActivityAt: '2020-01-01T00:00:00Z' } as unknown as Task
function renderCard(task = oldTask) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  renderWithProviders(<MeContext value={{ id: 'u', name: 'User', role: '', roles: ['member'], locale: 'ko', theme: 'system', email: null, emailIsDefault: false }}><TooltipProvider><ConversationCard task={task} onTagClick={() => undefined} onStatusChange={vi.fn()} /></TooltipProvider></MeContext>)
}
afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem('mes-locale') })

it.each([['ko', '정체'], ['en', 'Stalled']])('labels stalled kanban cards in %s with a contrasting badge', async (locale, label) => {
  localStorage.setItem('mes-locale', locale)
  renderCard()
  const badge = await screen.findByText(label)
  expect(badge).toHaveAttribute('data-task-stalled')
  expect(badge).toHaveClass('text-tone-warning-fg', 'bg-tone-warning-bg')
})

it('shows legacy todo status but excludes todo and done from status choices', async () => {
  renderCard({ ...oldTask, status: 'todo' })
  expect(screen.getByText('대기')).toBeInTheDocument()
  expect(screen.queryByText('정체')).not.toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('button', { name: '상태 변경' }))
  const menu = screen.getByRole('menu')
  expect(within(menu).getAllByRole('menuitemradio').map(item => item.textContent)).toEqual(['진행 중', '보류'])
})

it('judges stalled time by the server clock, not a fast browser clock', async () => {
  const hour = 60 * 60 * 1000
  const serverNow = Date.now() - 2 * hour // 브라우저 시계가 서버보다 2시간 빠르다
  const health = vi.fn(async () => new Response('{}', { headers: { date: new Date(serverNow).toUTCString() } }))
  const task = { ...oldTask, lastActivityAt: new Date(serverNow - 7 * 24 * hour + hour).toISOString() } // 서버 기준 6일 23시간
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/health' ? health() : Response.json([])))
  renderWithProviders(<MeContext value={{ id: 'u', name: 'User', role: '', roles: ['member'], locale: 'ko', theme: 'system', email: null, emailIsDefault: false }}><TooltipProvider><ConversationCard task={task} onTagClick={() => undefined} onStatusChange={vi.fn()} /></TooltipProvider></MeContext>)
  await waitFor(() => expect(health).toHaveBeenCalled())
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(screen.queryByText('정체')).not.toBeInTheDocument()
})

it('S14: 카드의 SR 칩(태그·시작 SR)은 SR 상세를 열고 일반 태그는 필터로 쓴다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/service-requests?code=SR-2026-0002' ? [{ id: 'sr-2' }] : [])))
  const onTagClick = vi.fn()
  function Probe() { const location = useLocation(); return <output aria-label="경로">{location.pathname + location.search}</output> }
  renderWithProviders(<MeContext value={{ id: 'u', name: 'User', role: '', roles: ['member'], locale: 'ko', theme: 'system', email: null, emailIsDefault: false }}><TooltipProvider>
    <ConversationCard task={{ ...oldTask, tags: ['SR-2026-0001', '일반'], linkedSrCodes: ['SR-2026-0002', 'SR-2026-0001'] }} onTagClick={onTagClick} /><Probe /></TooltipProvider></MeContext>)
  await userEvent.click(screen.getByRole('button', { name: '일반' }))
  expect(onTagClick).toHaveBeenCalledWith('일반')
  await userEvent.click(screen.getByRole('button', { name: 'SR-2026-0002' }))
  await waitFor(() => expect(screen.getByLabelText('경로')).toHaveTextContent('/sr/manage?id=sr-2'))
  expect(onTagClick).toHaveBeenCalledTimes(1)
})
