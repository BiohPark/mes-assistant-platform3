import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { ProfileProvider } from '@/app/profile'
import { emptyHomeFilters, useUiStore } from '@/app/uiStore'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { HomePage } from './HomePage'

const first = { level1: 'One', level2: 'Alpha', level1CodeId: 'one', level2CodeId: 'alpha' }
const second = { level1: 'Two', level2: 'Beta', level1CodeId: 'two', level2CodeId: 'beta' }
const a = { ...first, classifications: [first, second], id: 'a', name: 'Multi agent', summary: 'description', order: 1, expectedInputs: ['Prompt'], expectedOutputs: ['Answer'], ownerId: 'u', status: 'open', usageExample: '', color: '#2563eb', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', revision: 0 }
const b = { ...a, ...second, classifications: [second], id: 'b', name: 'Other agent', order: 2 }
let catalog: unknown = [a, b]
let tasks: unknown[] = []
function Navigation() {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-testid="url">{location.search}</output><button onClick={() => void navigate(-1)}>Back</button><button onClick={() => void navigate(1)}>Forward</button></>
}
function renderHome(route = '/', owner = false) {
  return renderWithProviders(<MeContext value={{ id: 'u', name: 'User', role: '', roles: [owner ? 'system_owner' : 'member'], theme: 'system', locale: 'ko' }}><TooltipProvider><Navigation /><HomePage /></TooltipProvider></MeContext>, { route })
}
beforeEach(() => {
  catalog = [a, b]; tasks = []
  useUiStore.setState({ homeFilters: emptyHomeFilters() })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/assistants') return catalog instanceof Promise ? catalog : jsonResponse(200, catalog)
    if (url === '/api/tasks') return jsonResponse(200, tasks)
    return jsonResponse(200, [])
  }))
})
it('URL wins over persisted state, matches secondary paths, and rejects cross-path matches', async () => {
  useUiStore.getState().setHomeFilters({ q: 'wrong', level1CodeIds: ['one'] })
  renderHome('/?l1=two&l2=beta&aq=Multi')
  expect(await screen.findByText('Multi agent')).toBeInTheDocument()
  expect(screen.queryByText('Other agent')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Two' })).toHaveAttribute('aria-pressed', 'true')
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Two' }))
  await user.click(screen.getByRole('button', { name: 'One' }))
  expect(screen.queryByText('Multi agent')).not.toBeInTheDocument()
  expect(screen.getByText('조건에 맞는 에이전트가 없습니다')).toBeInTheDocument()
})
it('restores saved filters before catalog loading and prunes only invalid IDs afterwards', async () => {
  useUiStore.getState().setHomeFilters({ level1CodeIds: ['two', 'removed'], level2CodeIds: ['beta'] })
  let resolve!: (value: Response) => void
  catalog = new Promise<Response>(done => { resolve = done })
  renderHome()
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('l1=removed'))
  expect(useUiStore.getState().homeFilters.level1CodeIds).toEqual(['two', 'removed'])
  await act(async () => resolve(jsonResponse(200, [a, b])))
  expect(await screen.findByText('Multi agent')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('url')).not.toHaveTextContent('removed'))
  expect(useUiStore.getState().homeFilters.level1CodeIds).toEqual(['two'])
})
it('back/forward follows URL, reset clears storage, and both view switches keep other parameters', async () => {
  renderHome('/?tag=keep')
  const user = userEvent.setup()
  await screen.findByText('Multi agent')
  await user.click(screen.getByRole('button', { name: 'One' }))
  expect(screen.queryByText('Other agent')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(await screen.findByText('Other agent')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Forward' }))
  await waitFor(() => expect(screen.queryByText('Other agent')).not.toBeInTheDocument())
  await user.click(screen.getByRole('tab', { name: '전체 대화 칸반' }))
  expect(screen.getByTestId('url')).toHaveTextContent('l1=one')
  expect(screen.getByTestId('url')).toHaveTextContent('tag=keep')
  await user.click(screen.getByRole('tab', { name: '에이전트 카드' }))
  expect(screen.getByTestId('url')).toHaveTextContent('l1=one')
  expect(screen.getByTestId('url')).toHaveTextContent('tag=keep')
  await user.click(screen.getByRole('button', { name: '초기화' }))
  expect(useUiStore.getState().homeFilters).toEqual(emptyHomeFilters())
  expect(JSON.parse(localStorage.getItem('mes-hub-ui')!).state.homeFilters).toEqual(emptyHomeFilters())
  expect(screen.getByTestId('url')).not.toHaveTextContent('l1=')
})
it('separates search clear from filter reset in an empty result', async () => {
  renderHome('/?aq=missing&l1=one')
  await screen.findByText('조건에 맞는 에이전트가 없습니다')
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '필터 1개 초기화' }))
  expect(screen.getByPlaceholderText('이름 · 요약 · 업무 분류 검색')).toHaveValue('missing')
  expect(screen.getByRole('button', { name: 'One' })).toHaveAttribute('aria-pressed', 'false')
  await user.click(screen.getByRole('button', { name: '검색어 지우기' }))
  expect(screen.getByText('Other agent')).toBeInTheDocument()
})
it('shows at most six owned/participating in-progress conversations and owner-only edit links', async () => {
  tasks = Array.from({ length: 9 }, (_, index) => ({ id: `task-${index}`, title: `Task ${index}`, code: `WK-${index}`, status: index === 8 ? 'done' : 'in_progress', ownerId: index === 7 ? 'other' : 'u', assigneeIds: [], lastActivityAt: String(index) }))
  renderHome('/', true)
  const region = screen.getByRole('region', { name: '내 진행 중 대화' })
  await waitFor(() => expect(within(region).getAllByRole('link')).toHaveLength(6))
  expect(within(region).getAllByRole('link')[0]).toHaveAttribute('href', '/c/task-6')
  expect(screen.getByRole('link', { name: '에이전트 관리' })).toHaveAttribute('href', '/assistants/manage')
  expect(await screen.findByRole('link', { name: 'Multi agent 편집' })).toHaveAttribute('href', '/assistants/manage?edit=a')
  const card = screen.getByText('Multi agent').closest('div.group')!
  expect(card).not.toHaveClass('aspect-square')
  expect(card).toHaveTextContent('Prompt')
  expect(card.parentElement).toHaveClass('xl:grid-cols-4')
})
it('hides owner edit actions from members', async () => {
  renderHome()
  await screen.findByText('Multi agent')
  expect(screen.queryByRole('link', { name: '에이전트 관리' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Multi agent 편집' })).not.toBeInTheDocument()
})
it('canonicalizes unique legacy kanban stages after catalog loading and renders one column with +N', async () => {
  renderHome('/?view=kanban&stage=Two%2FBeta')
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('stage=two%2Fbeta'))
  expect(screen.getByRole('region', { name: 'Multi agent 열' })).toHaveTextContent('One › Alpha +1')
  expect(screen.getAllByRole('region', { name: 'Multi agent 열' })).toHaveLength(1)
  fireEvent.click(screen.getByText('단계 1'))
  expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-pressed', 'true')
})

it('kanban filter changes participate in back/forward history', async () => {
  renderHome('/?view=kanban')
  await screen.findByRole('region', { name: 'Multi agent 열' })
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '진행 중' }))
  expect(screen.getByTestId('url')).toHaveTextContent('status=in_progress')
  await user.click(screen.getByRole('button', { name: 'Back' }))
  await waitFor(() => expect(screen.getByTestId('url')).not.toHaveTextContent('status='))
  await user.click(screen.getByRole('button', { name: 'Forward' }))
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('status=in_progress'))
})

it.each(['/?view=kanban&q=conversation&tag=keep', '/?view=kanban&q=conversation&tag=keep&stage=Two%2FBeta', '/?tag=keep'])('restores saved card filters on entry without card keys: %s', async route => {
  useUiStore.getState().setHomeFilters({ q: 'Multi', level1CodeIds: ['two'], level2CodeIds: ['beta'], showRetired: true })
  renderHome(route)
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('aq=Multi'))
  expect(useUiStore.getState().homeFilters).toEqual({ q: 'Multi', level1CodeIds: ['two'], level2CodeIds: ['beta'], showRetired: true })
  expect(screen.getByTestId('url')).toHaveTextContent('tag=keep')
  if (route.includes('kanban')) {
    expect(screen.getByPlaceholderText('코드 · 제목 · 태그 검색')).toHaveValue('conversation')
    if (route.includes('stage=')) await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('stage=two%2Fbeta'))
    fireEvent.click(screen.getByRole('tab', { name: '에이전트 카드' }))
  }
  expect(await screen.findByText('Multi agent')).toBeInTheDocument()
  expect(screen.queryByText('Other agent')).not.toBeInTheDocument()
})

it('treats an explicit empty card search as a URL override of saved filters', async () => {
  useUiStore.getState().setHomeFilters({ q: 'Multi', level1CodeIds: ['one'] })
  renderHome('/?aq=&q=conversation')
  expect(await screen.findByText('Other agent')).toBeInTheDocument()
  expect(useUiStore.getState().homeFilters).toEqual(emptyHomeFilters())
  expect(screen.getByTestId('url')).toHaveTextContent('q=conversation')
})

it('replaces card search edits while chip toggles and reset push history', async () => {
  renderHome('/?q=conversation')
  await screen.findByText('Multi agent')
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'One' }))
  const input = screen.getByPlaceholderText('이름 · 요약 · 업무 분류 검색')
  await user.type(input, 'Multi')
  expect(input).toHaveValue('Multi')
  expect(screen.getByTestId('url')).toHaveTextContent('aq=Multi')
  await user.click(screen.getByRole('button', { name: 'Back' }))
  await waitFor(() => expect(screen.getByTestId('url')).not.toHaveTextContent('l1='))
  expect(input).toHaveValue('')
  expect(screen.getByTestId('url')).toHaveTextContent('q=conversation')
  await user.click(screen.getByRole('button', { name: 'Forward' }))
  await waitFor(() => expect(input).toHaveValue('Multi'))
  await user.click(screen.getByRole('button', { name: '초기화' }))
  expect(input).toHaveValue('')
  await user.click(screen.getByRole('button', { name: 'Back' }))
  await waitFor(() => expect(input).toHaveValue('Multi'))
  expect(screen.getByRole('button', { name: 'One' })).toHaveAttribute('aria-pressed', 'true')
})

it('replaces kanban search edits while status chips and view switches push history', async () => {
  renderHome('/?view=kanban&aq=Multi')
  await screen.findByRole('region', { name: 'Multi agent 열' })
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '진행 중' }))
  const input = screen.getByPlaceholderText('코드 · 제목 · 태그 검색')
  await user.type(input, 'hello')
  await user.click(screen.getByRole('button', { name: 'Back' }))
  await waitFor(() => expect(screen.getByTestId('url')).not.toHaveTextContent('status='))
  expect(input).toHaveValue('')
  expect(screen.getByTestId('url')).toHaveTextContent('aq=Multi')
  await user.click(screen.getByRole('button', { name: 'Forward' }))
  await waitFor(() => expect(input).toHaveValue('hello'))
  await user.click(screen.getByRole('tab', { name: '에이전트 카드' }))
  expect(screen.getByPlaceholderText('이름 · 요약 · 업무 분류 검색')).toHaveValue('Multi')
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(await screen.findByPlaceholderText('코드 · 제목 · 태그 검색')).toHaveValue('hello')
})

it.each([
  ['/', '이름 · 요약 · 업무 분류 검색', 'aq'],
  ['/?view=kanban', '코드 · 제목 · 태그 검색', 'q'],
])('keeps Korean composition local until completion: %s', async (route, placeholder, key) => {
  renderHome(route)
  await screen.findByText(route.includes('kanban') ? 'Multi agent' : 'Other agent')
  const input = screen.getByPlaceholderText(placeholder)
  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: 'ㅎ' } })
  expect(input).toHaveValue('ㅎ')
  expect(screen.getByTestId('url')).not.toHaveTextContent(`${key}=`)
  fireEvent.change(input, { target: { value: '한글' } })
  expect(input).toHaveValue('한글')
  fireEvent.compositionEnd(input, { data: '한글' })
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(`${key}=%ED%95%9C%EA%B8%80`))
})

it('clears a local whitespace draft when kanban reset leaves the URL search empty', async () => {
  renderHome('/?view=kanban&status=in_progress')
  await screen.findByRole('region', { name: 'Multi agent 열' })
  const user = userEvent.setup()
  const input = screen.getByPlaceholderText('코드 · 제목 · 태그 검색')
  await user.type(input, ' ')
  expect(input).toHaveValue(' ')
  await user.click(screen.getByRole('button', { name: '초기화' }))
  expect(input).toHaveValue('')
  expect(screen.getByTestId('url')).not.toHaveTextContent('status=')
})

it.each([
  ['/?aq=Multi', '이름 · 요약 · 업무 분류 검색', 'One', 'aq', 'Multi'],
  ['/?view=kanban&q=conversation', '코드 · 제목 · 태그 검색', '진행 중', 'q', 'conversation'],
])('releases an empty-search reset before history restores another query: %s', async (route, placeholder, chip, key, query) => {
  renderHome(route)
  await screen.findByRole('button', { name: route.includes('kanban') ? 'Alpha' : 'One', hidden: true })
  const user = userEvent.setup()
  const input = screen.getByPlaceholderText(placeholder)
  await user.click(screen.getByRole('button', { name: chip }))
  await user.clear(input)
  await user.click(screen.getByRole('button', { name: '초기화' }))
  await user.click(screen.getByRole('button', { name: 'Back' }))
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(input).toHaveValue(query)
  await user.click(screen.getByRole('button', { name: chip }))
  expect(new URLSearchParams(screen.getByTestId('url').textContent!).get(key)).toBe(query)
  expect(input).toHaveValue(query)
})

it.each([
  ['/?aq=프로토콜&tag=keep', '이름 · 요약 · 업무 분류 검색', 'aq', 'button', 'One', 'l1', 'one'],
  ['/?view=kanban&q=프로토콜&aq=Multi', '코드 · 제목 · 태그 검색', 'q', 'button', '진행 중', 'status', 'in_progress'],
  ['/?aq=프로토콜&tag=keep', '이름 · 요약 · 업무 분류 검색', 'aq', 'tab', '전체 대화 칸반', 'view', 'kanban'],
  ['/?view=kanban&q=프로토콜&aq=Multi', '코드 · 제목 · 태그 검색', 'q', 'tab', '에이전트 카드', 'view', ''],
] as const)('keeps a cleared search when another action supersedes its pending replace: %s (%s, %s, %s, %s)', async (route, placeholder, searchKey, role, action, filterKey, filterValue) => {
  let acknowledge!: () => void
  const pendingReplace = new Promise<void>(resolve => { acknowledge = resolve })
  const router = createMemoryRouter([{
    path: '/',
    hydrateFallbackElement: null,
    loader: async ({ request }) => {
      const params = new URL(request.url).searchParams
      if (!params.has(searchKey) && params.get(filterKey) === new URLSearchParams(route.split('?')[1]).get(filterKey)) await pendingReplace
      return null
    },
    element: <MeContext value={{ id: 'u', name: 'User', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><Navigation /><HomePage /></TooltipProvider></MeContext>,
  }], { initialEntries: [route] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ProfileProvider><RouterProvider router={router} /></ProfileProvider></QueryClientProvider>)
  try {
    await screen.findByRole(role, { name: action })
    // Wait for catalog loading before the edit, so normalization is not part of this race.
    await screen.findByRole('button', { name: route.includes('kanban') ? 'Alpha' : 'One', hidden: true })
    const input = screen.getByPlaceholderText(placeholder)
    fireEvent.change(input, { target: { value: '' } })
    expect(input).toHaveValue('')
    expect(new URLSearchParams(router.state.location.search).get(searchKey)).toBe('프로토콜')
    expect(router.state.navigation.state).toBe('loading')
    fireEvent.click(screen.getByRole(role, { name: action }))
    await waitFor(() => {
      expect(router.state.navigation.state).toBe('idle')
      // Loader completion precedes React's transition commit; read the committed URL.
      expect(screen.getByTestId('url').textContent).toBe(router.state.location.search)
    })
    const params = new URLSearchParams(screen.getByTestId('url').textContent!)
    expect(params.has(searchKey)).toBe(false)
    expect(params.get(filterKey) ?? '').toBe(filterValue)
    expect(input).toHaveValue('')
    expect(params.get(route.includes('kanban') ? 'aq' : 'tag')).toBe(route.includes('kanban') ? 'Multi' : 'keep')
    await act(async () => { acknowledge(); await pendingReplace })
    expect(input).toHaveValue('')
    expect(new URLSearchParams(router.state.location.search).get(filterKey) ?? '').toBe(filterValue)
    if (role === 'tab') {
      fireEvent.click(screen.getByRole('tab', { name: route.includes('kanban') ? '전체 대화 칸반' : '에이전트 카드' }))
      expect(await screen.findByPlaceholderText(placeholder)).toHaveValue('')
    }
  } finally {
    acknowledge()
    router.dispose()
  }
})

function renderRoutedHome(route: string, loader?: () => Promise<null>) {
  const router = createMemoryRouter([{ path: '/', hydrateFallbackElement: null, loader, element: <MeContext value={{ id: 'u', name: 'User', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><Navigation /><HomePage /></TooltipProvider></MeContext> }], { initialEntries: [route] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const committed = [route.slice(route.indexOf('?'))]
  router.subscribe(state => { if (state.navigation.state === 'idle' && state.location.search !== committed.at(-1)) committed.push(state.location.search) })
  render(<QueryClientProvider client={client}><ProfileProvider><RouterProvider router={router} /></ProfileProvider></QueryClientProvider>)
  let updates = 0
  // Query notifications are batched on a timer; wait for them so each update re-renders inside act.
  const stats = async () => { client.setQueryData(['assistant-stats'], [{ assistantId: 'a', open: ++updates, inProgress: 0, onHold: 0, done: 0 }]); await new Promise(resolve => setTimeout(resolve, 0)) }
  return { router, committed, stats }
}

it('navigates once per view switch and never from data updates', async () => {
  const { router, committed, stats } = renderRoutedHome('/?l1=one')
  try {
    await screen.findByText('Multi agent')
    fireEvent.click(screen.getByRole('tab', { name: '전체 대화 칸반' }))
    await screen.findByRole('region', { name: 'Multi agent 열' })
    for (let i = 0; i < 3; i++) await act(() => stats())
    expect(committed).toEqual(['?l1=one', '?l1=one&view=kanban'])
    fireEvent.click(screen.getByRole('tab', { name: '에이전트 카드' }))
    await screen.findByRole('button', { name: 'One' })
    for (let i = 0; i < 3; i++) await act(() => stats())
    expect(committed).toEqual(['?l1=one', '?l1=one&view=kanban', '?l1=one'])
  } finally { router.dispose() }
})

it('keeps a view switch that is still committing while data updates re-render the previous view', async () => {
  // CI condition: router commits in a transition while other users' events keep updating queries (S8 hub loop).
  let release: (() => void) | undefined
  let holding = false
  const { router, committed, stats } = renderRoutedHome('/?l1=one', async () => { if (holding) await new Promise<void>(resolve => { release = resolve }); return null })
  try {
    await screen.findByText('Multi agent')
    holding = true
    fireEvent.click(screen.getByRole('tab', { name: '전체 대화 칸반' }))
    expect(router.state.navigation.state).toBe('loading')
    await act(async () => { release!() })
    await screen.findByRole('region', { name: 'Multi agent 열' })
    fireEvent.click(screen.getByRole('tab', { name: '에이전트 카드' }))
    expect(router.state.navigation.state).toBe('loading')
    for (let i = 0; i < 3; i++) await act(() => stats())
    await act(async () => { release!() })
    await waitFor(() => expect(router.state.navigation.state).toBe('idle'))
    expect(router.state.location.search).toBe('?l1=one')
    expect(await screen.findByRole('button', { name: 'One' })).toHaveAttribute('aria-pressed', 'true')
    expect(committed).toEqual(['?l1=one', '?l1=one&view=kanban', '?l1=one'])
  } finally { release?.(); router.dispose() }
})
