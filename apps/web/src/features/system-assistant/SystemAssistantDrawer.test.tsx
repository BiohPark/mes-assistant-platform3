import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useUiStore } from '@/app/uiStore'
import { renderWithProviders } from '@/test/render'
import { AssistantPill } from '@/features/assistant-pill/AssistantPill'
import { MeContext } from '@/app/auth'
import type { Task } from '@mes/domain'
import { HomePage } from '@/features/home/HomePage'
import { TooltipProvider } from '@/components/ui/tooltip'
import { emptyHomeFilters } from '@/app/uiStore'
import { useLocation } from 'react-router'

vi.mock('@/app/hooks', async importOriginal => ({ ...await importOriginal<typeof import('@/app/hooks')>(), useActor: () => ({ userId: 'u' }) }))
afterEach(() => { act(() => useUiStore.getState().setAssistantOpen(false)); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function Location() {
  const { search } = useLocation()
  return <output data-testid="location-search">{search}</output>
}

it.each([false, true])('칸반에서 검색하면 도우미가 닫힌 뒤 카드 검색창에 포커스한다 (desktop=%s)', async desktop => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: desktop, media: query, addListener() {}, removeListener() {} }))
  const fetchMock = vi.fn(async (url: string) => Response.json(url === '/api/system-assistant/model' || url === '/api/settings' ? {} : []))
  vi.stubGlobal('fetch', fetchMock)
  useUiStore.setState({ assistantOpen: false, homeFilters: emptyHomeFilters() })
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><HomePage /><AssistantPill /><Location /></TooltipProvider></MeContext>, { route: '/?view=kanban&tag=keep&aq=agent' })
  expect(screen.queryByRole('textbox', { name: '이름 · 요약 · 업무 분류 검색' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'AI 도우미 열기' }))
  fireEvent.click(screen.getByRole('button', { name: '에이전트 검색' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole('textbox', { name: '이름 · 요약 · 업무 분류 검색' })).toHaveFocus())
  expect(screen.getByRole('tab', { name: '에이전트 카드' })).toHaveAttribute('aria-selected', 'true')
  const params = new URLSearchParams(screen.getByTestId('location-search').textContent!)
  expect(params.has('view')).toBe(false)
  expect(params.get('tag')).toBe('keep')
  expect(params.get('aq')).toBe('agent')
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/system-assistant/messages')).toBe(false)
})

it('메뉴 이동은 시트를 닫고 기존 검색 입력에 포커스하며 AI를 호출하지 않는다', async () => {
  const fetchMock = vi.fn(async (_url: string) => Response.json({ mode: 'mock', model: 'mock' }))
  vi.stubGlobal('fetch', fetchMock)
  useUiStore.getState().setAssistantOpen(true)
  renderWithProviders(<><input aria-label="이름 · 요약 · 업무 분류 검색" /><AssistantPill /></>)
  fireEvent.click(screen.getByRole('button', { name: '에이전트 검색' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole('textbox', { name: '이름 · 요약 · 업무 분류 검색' })).toHaveFocus())
  expect(fetchMock.mock.calls.every(call => !String(call[0]).includes('/messages'))).toBe(true)
})

it('예시 프리필 후 명시적으로 전송·적용하면 기존 성공 표시가 유지된다', async () => {
  const task: Task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'ai', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], createdAt: '2026-10-01T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-10-01T00:00:00.000Z' }
  const writes: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/system-assistant/messages') return Response.json({ text: '확인하세요', toolCalls: [{ id: 'tag', name: 'add_tag', arguments: '{"taskCode":"WK-2026-0001","tag":"release"}' }] })
    if (url.startsWith('/api/tasks?')) return Response.json([task])
    if (url === '/api/tasks/t/tags/release' && init?.method === 'PUT') { writes.push(url); return new Response(null, { status: 204 }) }
    return Response.json({ mode: 'mock', model: 'mock' })
  }))
  useUiStore.getState().setAssistantOpen(true)
  renderWithProviders(<AssistantPill />)
  fireEvent.click(screen.getByRole('button', { name: /FDS 작성 도우미로/ }))
  expect(writes).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  fireEvent.click(await screen.findByRole('button', { name: '적용' }))
  await waitFor(() => expect(writes).toEqual(['/api/tasks/t/tags/release']))
  expect(await screen.findByText('WK-2026-0001에 release 태그를 붙였습니다.')).toHaveClass('text-tone-success-fg')
})

// jsdom의 matchMedia는 항상 false → <1024 경로(우측 시트). 데스크톱 팝오버는 AssistantPill.test가 다룬다

it('잘못된 도구 호출은 제안 불가 사유를 표시하고 적용 버튼을 숨긴다', async () => {
  const fetchMock = vi.fn(async (url: string) => url === '/api/system-assistant/messages'
    ? Response.json({ text: '확인하세요', toolCalls: [{ id: 'bad', name: 'start_conversation', arguments: '{"assistantName":"FDS","priority":"critical"}' }] })
    : Response.json({ mode: 'mock', model: 'mock' }))
  vi.stubGlobal('fetch', fetchMock)
  useUiStore.getState().setAssistantOpen(true)
  renderWithProviders(<AssistantPill />)
  fireEvent.click(screen.getByText(/FDS 작성 도우미로/))
  expect((screen.getByRole('textbox', { name: 'AI 요청 입력' }) as HTMLTextAreaElement).value).toContain('FDS 작성 도우미로')
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/system-assistant/messages')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(screen.getByText('제안 불가')).toBeInTheDocument())
  expect(screen.getByRole('alert')).toHaveTextContent('priority')
  expect(screen.queryByRole('button', { name: '적용' })).not.toBeInTheDocument()
})

it('서랍을 닫으면 진행 중인 요청의 신호를 중단한다', async () => {
  let signal: AbortSignal | undefined
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== '/api/system-assistant/messages') return Response.json({ mode: 'mock', model: 'mock' })
    signal = init?.signal as AbortSignal
    return new Promise<Response>(() => undefined)
  }))
  useUiStore.getState().setAssistantOpen(true)
  renderWithProviders(<AssistantPill />)
  fireEvent.click(screen.getByText(/FDS 작성 도우미로/))
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(signal).toBeDefined())
  fireEvent.click(screen.getByRole('button', { name: '시스템 assistant 닫기' }))
  await waitFor(() => expect(signal?.aborted).toBe(true))
})

it('에이전트 등록 예시와 제안 인자에서 내부 ID를 표시하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/system-assistant/messages'
    ? Response.json({ text: '확인하세요', toolCalls: [{ id: 'create', name: 'create_assistant', arguments: '{"id":"internal-agent-uuid","name":"새 도우미","classifications":[{"level1":"Record","level2":"라벨"}]}' }] })
    : Response.json({ mode: 'mock', model: 'mock' })))
  useUiStore.getState().setAssistantOpen(true)
  renderWithProviders(<MeContext value={{ id: 'u', name: '운영자', role: '', email: null, emailIsDefault: false, roles: ['system_owner'], theme: 'system', locale: 'ko' }}><AssistantPill /></MeContext>, { route: '/settings' })
  const drawer = screen.getByRole('dialog', { name: '시스템 assistant' }) // Sheet는 portal에 그려져 container 밖이다
  expect(screen.getByRole('button', { name: /에이전트 등록/ })).not.toHaveTextContent('ID')
  fireEvent.click(screen.getByRole('button', { name: /에이전트 등록/ }))
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '적용' })).toBeInTheDocument())
  fireEvent.click(screen.getByText('인자 보기'))
  expect(drawer).not.toHaveTextContent('internal-agent-uuid')
  expect(drawer.querySelector('pre')).toHaveTextContent('새 도우미')
})

it('서랍은 이름 있는 dialog로 열리고 Esc로 닫히면 포커스가 알약으로 돌아간다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ mode: 'mock', model: 'mock' })))
  useUiStore.getState().setAssistantOpen(true)
  renderWithProviders(<AssistantPill />)
  const dialog = screen.getByRole('dialog', { name: '시스템 assistant' })
  expect(dialog).toHaveAttribute('data-slot', 'sheet-content')
  expect(dialog).toHaveAttribute('data-side', 'right')
  expect(screen.getByRole('button', { name: '시스템 assistant 닫기' })).toBeInTheDocument()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(useUiStore.getState().assistantOpen).toBe(false))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '시스템 assistant' })).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'AI 도우미 열기' })).toHaveFocus()
})

it('대화 이력은 창을 닫았다 열어도 남는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/system-assistant/messages'
    ? Response.json({ text: '남는 답변', toolCalls: [] })
    : Response.json({ mode: 'mock', model: 'mock' })))
  useUiStore.getState().setAssistantOpen(true)
  renderWithProviders(<AssistantPill />)
  fireEvent.click(screen.getByText(/FDS 작성 도우미로/))
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await screen.findByText('남는 답변')
  fireEvent.click(screen.getByTestId('assistant-pill')) // 모달 시트가 열린 동안 바깥은 aria-hidden이라 역할로는 못 찾는다
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'AI 도우미 열기' }))
  expect(await screen.findByText('남는 답변')).toBeInTheDocument()
})
