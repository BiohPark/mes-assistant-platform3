import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AssistantStatusBadge, PriorityBadge, SrStatusBadge, TaskStatusBadge } from '@/components/StatusBadges'
import { ConversationCard } from '@/features/home/ConversationCard'
import type { Task } from '@mes/domain'
import { AppShell } from './AppShell'
import { AuthGate } from './AuthGate'
import { TopBar } from './TopBar'

vi.mock('./NotificationBell', () => ({ NotificationBell: () => null }))
vi.mock('./useEvents', () => ({ useEvents: () => undefined }))
vi.mock('@/features/system-assistant/SystemAssistantDrawer', () => ({ SystemAssistantDrawer: () => null }))

const me = { id: 'owner', name: 'Kim', roles: ['member', 'system_owner'], role: '', theme: 'system', locale: 'ko' }
const task: Task = { id: 't1', code: 'WK-1', title: 'Example', titleSource: 'manual', summary: '', assistantId: 'a1', ownerId: 'owner', createdBy: 'owner', assigneeIds: [], status: 'todo', priority: 'normal', tags: [], inputs: [], outputFileIds: [], checklist: [], createdAt: '2026-10-06T12:00:00Z', lastActivityAt: '2026-10-06T12:00:00Z' }

beforeEach(() => localStorage.clear())
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

it('/me locale renders the sidebar in English', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/me' ? jsonResponse(200, { ...me, locale: 'en' }) : jsonResponse(200, [])))
  renderWithProviders(<AppShell />)
  for (const name of ['Agent Hub', 'Submit SR', 'Reports', 'Manage SR', 'Manage agents', 'Settings', 'Diagnostics']) {
    expect(await screen.findByRole('link', { name })).toBeInTheDocument()
  }
  expect(screen.queryByRole('link', { name: '에이전트 허브' })).not.toBeInTheDocument()
})

it('cached locale renders menus, all status families and relative dates in English', async () => {
  localStorage.setItem('mes-locale', 'en')
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  // No AuthGate: the login-before-/me cache is the initial source.
  const { MeContext } = await import('./auth')
  renderWithProviders(<MeContext value={{ ...me, roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><TopBar /><TaskStatusBadge status="todo" /><AssistantStatusBadge status="developing" /><SrStatusBadge status="submitted" /><PriorityBadge priority="urgent" /><ConversationCard task={task} onTagClick={() => undefined} /></TooltipProvider></MeContext>)
  expect(screen.getAllByText('Pending')).toHaveLength(2)
  expect(screen.getByText('In development')).toBeInTheDocument()
  expect(screen.getByText('Submitted')).toBeInTheDocument()
  expect(screen.getByText('Urgent')).toBeInTheDocument()
  expect(screen.getByText(/ago$/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Kim/ }))
  for (const name of ['My info', 'Change password', 'Log out']) expect(screen.getByRole('menuitem', { name })).toBeInTheDocument()
  for (const name of ['System', 'Light', 'Dark', '한국어', 'English']) expect(screen.getByRole('menuitemradio', { name })).toBeInTheDocument()
})

it('English selection immediately translates and a failed save rolls back translations', async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/me' ? Promise.resolve(jsonResponse(200, { ...me, roles: ['member'] })) : new Promise<Response>((resolve) => { finish = resolve })))
  renderWithProviders(<AuthGate><TooltipProvider><TopBar /><TaskStatusBadge status="done" /><ConversationCard task={task} onTagClick={() => undefined} /></TooltipProvider></AuthGate>)
  await userEvent.click(await screen.findByRole('button', { name: /Kim/ }))
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'English' }))
  expect(await screen.findByText('Done')).toBeInTheDocument()
  expect(screen.getByText(/ago$/)).toBeInTheDocument()
  finish(jsonResponse(500, { message: 'Save failed' }))
  await waitFor(() => expect(screen.getByText('완료')).toBeInTheDocument())
  expect(screen.queryByText('Done')).not.toBeInTheDocument()
  expect(screen.getByText(/전$/)).toBeInTheDocument()
  expect(localStorage.getItem('mes-locale')).toBe('ko')
})
