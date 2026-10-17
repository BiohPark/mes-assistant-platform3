import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createContext, use } from 'react'
import { createMemoryRouter, Navigate, RouterProvider, useNavigate, useParams, useRoutes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { jsonResponse } from '@/test/render'
import { TabHost } from './TabHost'
import { useTabActive } from './tabActive'
import { initialTabs, MAX_ALIVE, useTabsStore } from './tabs'

// 작은 화면 목록 — 입력 상태가 탭 전환을 넘어 남는지, 숨은 탭의 리다이렉트가 주소를 빼앗지 않는지 본다
vi.mock('./pageRoutes', () => ({ PageView: () => TestPages() }))

function Page({ name }: { name: string }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const active = useTabActive()
  const label = id ? `${name} ${id}` : name
  return <div><h1>{label}</h1><input aria-label={`${label} 입력`} /><span>{active ? '보임' : '숨김'}</span>
    <button type="button" onClick={() => void navigate('/', { replace: true })}>{label} 되돌리기</button></div>
}
function TestPages() {
  return useRoutes([
    { index: true, element: <Page name="홈" /> },
    { path: 'c/:id', element: <Page name="대화" /> },
    { path: 'old/:id', element: <Navigate to="/c/moved" replace /> },
  ])
}

beforeEach(() => {
  sessionStorage.clear()
  useTabsStore.setState(initialTabs('/'), true)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const id = /\/tasks\/([^/?]+)/.exec(url)?.[1]
    return id ? jsonResponse(200, { id, code: `WK-${id}`, title: `제목 ${id}` }) : jsonResponse(404)
  }))
})
afterEach(() => vi.unstubAllGlobals())

function renderHost(path = '/') {
  const router = createMemoryRouter([{ path: '/*', element: <TabHost home="/" userId="u" /> }], { initialEntries: [path] })
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}
const tabs = () => within(screen.getByRole('tablist', { name: '열린 화면' })).getAllByRole('tab')
// 숨은 탭의 글자는 접근 이름에서 빠지므로 글자로 찾는다
const panelOf = (heading: string) => screen.getByText(heading, { selector: 'h1' }).closest<HTMLElement>('[role="tabpanel"]')!

it('새 경로는 새 탭으로 열고, 전환해도 숨은 탭의 입력이 그대로 남는다', async () => {
  const router = renderHost()
  await userEvent.type(await screen.findByRole('textbox', { name: '홈 입력' }), '작성 중')
  await act(() => router.navigate('/c/a'))
  expect(await screen.findByRole('tab', { name: 'WK-a · 제목 a' })).toHaveAttribute('aria-selected', 'true')
  expect(tabs().map(tab => tab.textContent)).toEqual(['에이전트 허브', 'WK-a · 제목 a'])
  expect(panelOf('홈')).toHaveAttribute('inert')
  expect(within(panelOf('홈')).getByText('숨김')).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: '홈 입력' })).not.toBeInTheDocument() // 숨은 탭은 보조기기에도 숨는다

  await userEvent.click(screen.getByRole('tab', { name: '에이전트 허브' }))
  expect(router.state.location.pathname).toBe('/')
  expect(screen.getByRole('textbox', { name: '홈 입력' })).toHaveValue('작성 중')
  expect(panelOf('대화 a')).toHaveAttribute('inert')
  expect(tabs()).toHaveLength(2) // 같은 경로는 기존 탭을 활성화
})

it('활성 탭을 닫으면 이웃 탭으로 주소가 바뀐다(REPLACE)', async () => {
  const router = renderHost()
  await act(() => router.navigate('/c/a'))
  await act(() => router.navigate('/c/b'))
  fireEvent.click((await screen.findByRole('tab', { name: 'WK-b · 제목 b' })).parentElement!.querySelector('[data-tab-close]')!)
  expect(router.state.location.pathname).toBe('/c/a')
  expect(router.state.historyAction).toBe('REPLACE')
  expect(tabs()).toHaveLength(2)
})

it('뒤로·앞으로가기는 그 주소의 탭을 활성화하고, 닫은 탭이면 다시 연다', async () => {
  const router = renderHost()
  await act(() => router.navigate('/c/a'))
  await act(() => router.navigate('/c/b'))
  await act(() => router.navigate(-1))
  expect(await screen.findByRole('tab', { name: 'WK-a · 제목 a' })).toHaveAttribute('aria-selected', 'true')
  expect(tabs()).toHaveLength(3)
  fireEvent.click(screen.getByRole('tab', { name: 'WK-b · 제목 b' }).parentElement!.querySelector('[data-tab-close]')!)
  expect(tabs()).toHaveLength(2)
  await act(() => router.navigate(1))
  expect(router.state.location.pathname).toBe('/c/b')
  expect(await screen.findByRole('tab', { name: 'WK-b · 제목 b' })).toHaveAttribute('aria-selected', 'true')
})

it('가운데 클릭·Delete로 닫고, 홈 탭은 닫히지 않는다', async () => {
  const router = renderHost()
  await act(() => router.navigate('/c/a'))
  await act(() => router.navigate('/c/b'))
  fireEvent(screen.getByRole('tab', { name: /제목 a$/ }).parentElement!, new MouseEvent('auxclick', { bubbles: true, button: 1 }))
  expect(tabs()).toHaveLength(2)
  expect(router.state.location.pathname).toBe('/c/b') // 비활성 탭을 닫으면 주소는 그대로
  fireEvent.keyDown(screen.getByRole('tab', { name: /제목 b$/ }), { key: 'Delete' })
  expect(router.state.location.pathname).toBe('/')
  fireEvent.keyDown(screen.getByRole('tab', { name: '에이전트 허브' }), { key: 'Delete' })
  expect(tabs()).toHaveLength(1)
})

it('←/→로 탭을 옮겨 다닌다(자동 활성화)', async () => {
  const router = renderHost()
  await act(() => router.navigate('/c/a'))
  const current = await screen.findByRole('tab', { name: /제목 a$/ })
  current.focus()
  fireEvent.keyDown(current, { key: 'ArrowLeft' })
  expect(router.state.location.pathname).toBe('/')
  expect(screen.getByRole('tab', { name: '에이전트 허브' })).toHaveFocus()
})

it('숨은 탭의 리다이렉트는 그 탭에만 반영되고 보고 있는 탭의 주소를 바꾸지 않는다', async () => {
  const router = renderHost()
  await act(() => router.navigate('/c/a'))
  await act(() => router.navigate('/c/b'))
  fireEvent.click(screen.getByText('대화 a 되돌리기'))
  expect(router.state.location.pathname).toBe('/c/b')
  expect(tabs().map(tab => tab.textContent)).toEqual(['에이전트 허브', 'WK-b · 제목 b']) // 홈과 합쳐졌다
})

it('보고 있는 탭의 리다이렉트(REPLACE)는 그 탭을 새 주소로 바꾼다', async () => {
  const router = renderHost()
  await act(() => router.navigate('/old/1'))
  expect(router.state.location.pathname).toBe('/c/moved')
  expect(await screen.findByRole('tab', { name: 'WK-moved · 제목 moved' })).toHaveAttribute('aria-selected', 'true')
  expect(tabs()).toHaveLength(2)
})

it(`살려 두는 화면은 최근 본 ${MAX_ALIVE}개 — 넘치면 오래된 화면을 내리고 칩은 남긴다`, async () => {
  const router = renderHost()
  for (let index = 1; index <= MAX_ALIVE; index++) await act(() => router.navigate(`/c/${index}`))
  expect(tabs()).toHaveLength(MAX_ALIVE + 1)
  expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(MAX_ALIVE)
  expect(screen.queryByText('홈', { selector: 'h1' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: '에이전트 허브' }))
  expect(screen.getByRole('heading', { name: '홈' })).toBeInTheDocument() // 다시 열면 새로 그린다
  expect(screen.queryByText('대화 1', { selector: 'h1' })).not.toBeInTheDocument()
})

it('끌어서 순서를 바꾸되 홈은 맨 앞에 남는다', async () => {
  const router = renderHost()
  await act(() => router.navigate('/c/a'))
  await act(() => router.navigate('/c/b'))
  const data = new Map<string, string>()
  await screen.findByRole('tab', { name: 'WK-b · 제목 b' })
  const dataTransfer = { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? '', get types() { return [...data.keys()] }, effectAllowed: '', dropEffect: '' }
  fireEvent.dragStart(screen.getByRole('tab', { name: /제목 b$/ }).parentElement!, { dataTransfer })
  fireEvent.dragOver(screen.getByRole('tab', { name: /제목 a$/ }).parentElement!, { dataTransfer })
  fireEvent.drop(screen.getByRole('tab', { name: /제목 a$/ }).parentElement!, { dataTransfer })
  expect(tabs().map(tab => tab.textContent)).toEqual(['에이전트 허브', 'WK-b · 제목 b', 'WK-a · 제목 a'])
  expect(router.state.location.pathname).toBe('/c/b')
})

it('브라우저 탭 저장소(sessionStorage)에 열린 탭을 남긴다', async () => {
  const router = renderHost()
  await act(() => router.navigate('/c/a?x=1'))
  expect(JSON.parse(sessionStorage.getItem('mes-tabs')!).state.tabs.map((tab: { href: string }) => tab.href)).toEqual(['/', '/c/a?x=1'])
})

const Single = createContext(false)
function ModeHost() { return <TabHost home="/" userId="u" single={use(Single)} /> }

it('화면 하나 모드(모바일·팝업)는 탭 줄·탭 열기 없이 지금처럼 동작하고, 모드를 바꿔도 보던 화면이 다시 마운트되지 않는다', async () => {
  const router = createMemoryRouter([{ path: '/*', element: <ModeHost /> }], { initialEntries: ['/'] })
  const client = new QueryClient()
  const view = (single: boolean) => <Single value={single}><QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider></Single>
  const { rerender } = render(view(false))
  await act(() => router.navigate('/c/a'))
  await userEvent.type(await screen.findByRole('textbox', { name: '대화 a 입력' }), '쓰는 중')
  rerender(view(true))
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '대화 a 입력' })).toHaveValue('쓰는 중')
  await act(() => router.navigate('/c/b'))
  expect(screen.getByRole('heading', { name: '대화 b' })).toBeInTheDocument()
  expect(useTabsStore.getState().tabs).toHaveLength(2) // 화면 하나 모드의 이동은 탭을 늘리지 않는다
  await act(() => router.navigate('/c/a'))
  rerender(view(false))
  expect(await screen.findByRole('tablist', { name: '열린 화면' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '대화 a 입력' })).toHaveValue('쓰는 중')
})
