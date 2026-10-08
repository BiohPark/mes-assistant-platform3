import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation, useNavigate } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
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
