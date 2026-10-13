import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Task } from '@mes/domain'
import type { Locale } from '@mes/contracts'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { ConversationCard } from '@/features/home/ConversationCard'
import { QuickSwitch } from '@/features/task/QuickSwitch'
import { I18nProvider } from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { markConversationViewed, useConversationUnread } from './conversationRead'

const task: Task = {
  id: 'unread-task', code: 'WK-2026-0001', assistantId: 'assistant', title: 'Conversation', titleSource: 'default', summary: '',
  status: 'in_progress', priority: 'normal', ownerId: 'unread-user', assigneeIds: [], tags: [], inputs: [], checklist: [], outputFileIds: [],
  threadId: 'unread-thread', createdAt: '2026-10-01T00:00:00Z', createdBy: 'unread-user', lastActivityAt: '2026-10-13T00:00:00Z',
}
const me = { id: 'unread-user', name: 'User', role: '', email: null, emailIsDefault: false, roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }
function Probe({ userId = me.id, currentTask = task }: { userId?: string; currentTask?: Task }) { return <output>{String(useConversationUnread(currentTask, userId))}</output> }
function mount(userId = me.id, currentTask = task) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Probe userId={userId} currentTask={currentTask} /></QueryClientProvider>)
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

it('compares last viewed with task activity, scopes by user and updates subscribers without fetching', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  mount()
  expect(screen.getByRole('status')).toHaveTextContent('true')
  act(() => markConversationViewed('another-user', task.id, Date.parse(task.lastActivityAt)))
  expect(screen.getByRole('status')).toHaveTextContent('true')
  act(() => markConversationViewed(me.id, task.id, Date.parse(task.lastActivityAt)))
  expect(screen.getByRole('status')).toHaveTextContent('false')
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['file', 'status'])('marks newer %s activity as unread without fetching messages', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  markConversationViewed(me.id, task.id, Date.parse(task.lastActivityAt) - 1000)
  mount()
  expect(screen.getByRole('status')).toHaveTextContent('true')
  expect(fetch).not.toHaveBeenCalled()
})

it('keeps viewed timestamps monotonic and scoped by conversation', () => {
  markConversationViewed(me.id, 'another-task', Date.parse(task.lastActivityAt))
  mount()
  expect(screen.getByRole('status')).toHaveTextContent('true')
  act(() => markConversationViewed(me.id, task.id, Date.parse(task.lastActivityAt)))
  act(() => markConversationViewed(me.id, task.id, Date.parse(task.lastActivityAt) - 1000))
  expect(screen.getByRole('status')).toHaveTextContent('false')
})

it('updates unread state when another tab writes the viewed timestamp', () => {
  mount()
  expect(screen.getByRole('status')).toHaveTextContent('true')
  act(() => {
    localStorage.setItem(`mes:last-viewed:${me.id}:${task.id}`, String(Date.parse(task.lastActivityAt)))
    window.dispatchEvent(new Event('storage'))
  })
  expect(screen.getByRole('status')).toHaveTextContent('false')
})

it.each([
  ['', task],
  [me.id, { ...task, lastActivityAt: 'invalid' }],
])('does not show unread without a user or valid activity timestamp (%s)', (userId, currentTask) => {
  mount(userId, currentTask)
  expect(screen.getByRole('status')).toHaveTextContent('false')
})

it.each(['reads and writes', 'writes'])('retains read state and notifies subscribers with denied localStorage %s', (denied) => {
  if (denied === 'reads and writes') vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  const currentTask = { ...task, id: `denied-${denied}` }
  const viewed = Date.parse(task.lastActivityAt)
  const { unmount } = mount(me.id, currentTask)
  expect(screen.getByRole('status')).toHaveTextContent('true')
  act(() => markConversationViewed('another-user', currentTask.id, viewed))
  act(() => markConversationViewed(me.id, 'another-denied-task', viewed))
  expect(screen.getByRole('status')).toHaveTextContent('true')
  act(() => markConversationViewed(me.id, currentTask.id, viewed))
  expect(screen.getByRole('status')).toHaveTextContent('false')
  act(() => markConversationViewed(me.id, currentTask.id, viewed - 1000))
  unmount()
  const remounted = mount(me.id, currentTask)
  expect(screen.getByRole('status')).toHaveTextContent('false')
  remounted.rerender(<Probe currentTask={{ ...currentTask, lastActivityAt: new Date(viewed + 1000).toISOString() }} />)
  expect(screen.getByRole('status')).toHaveTextContent('true')
  expect(fetch).not.toHaveBeenCalled()
})

it('shows completed response activity after leaving the conversation', () => {
  const currentTask = { ...task, id: 'completed-after-leaving' }
  markConversationViewed(me.id, currentTask.id, Date.parse(currentTask.lastActivityAt))
  const { rerender } = mount(me.id, currentTask)
  expect(screen.getByRole('status')).toHaveTextContent('false')
  rerender(<Probe currentTask={{ ...currentTask, lastActivityAt: '2026-10-13T00:00:10Z', aiRequest: null }} />)
  expect(screen.getByRole('status')).toHaveTextContent('true')
})

it.each([['ko', '새 활동'], ['en', 'New activity']] as const)('renders cards in %s with zero messages requests', async (locale: Locale, label) => {
  const fetchMock = vi.fn(async (_url: string) => Response.json([]))
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MeContext value={me}><I18nProvider locale={locale}><TooltipProvider><MemoryRouter>
    {Array.from({ length: 12 }, (_, index) => <ConversationCard key={index} task={{ ...task, id: `card-${index}`, threadId: `thread-${index}` }} onTagClick={() => undefined} />)}
  </MemoryRouter></TooltipProvider></I18nProvider></MeContext></QueryClientProvider>)
  await waitFor(() => expect(client.isFetching()).toBe(0))
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/messages'))).toHaveLength(0)
  expect(screen.getAllByRole('img', { name: label })).toHaveLength(12)
})

it('opens quick switch with zero messages requests', async () => {
  const tasks = Array.from({ length: 3 }, (_, index) => ({ ...task, id: `switch-${index}`, threadId: `thread-${index}` }))
  const fetchMock = vi.fn(async (url: string) => Response.json(url === '/api/tasks' ? tasks : []))
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MeContext value={me}><MemoryRouter><QuickSwitch currentTaskId="switch-0" /></MemoryRouter></MeContext></QueryClientProvider>)
  await waitFor(() => expect(client.isFetching()).toBe(0))
  await userEvent.click(screen.getByRole('button', { name: '빠른 전환' }))
  expect(await screen.findAllByRole('menuitem')).toHaveLength(3)
  await waitFor(() => expect(client.isFetching()).toBe(0))
  expect(fetchMock.mock.calls.filter(([url]) => url.includes('/messages'))).toHaveLength(0)
  expect(screen.getAllByRole('img', { name: '새 활동' })).toHaveLength(3)
})
