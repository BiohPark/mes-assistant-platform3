import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useUiStore } from '@/app/uiStore'
import { renderWithProviders } from '@/test/render'
import { AssistantPill } from '@/features/assistant-pill/AssistantPill'

vi.mock('@/app/hooks', () => ({ useActor: () => ({ userId: 'u' }) }))
afterEach(() => { act(() => useUiStore.getState().setAssistantOpen(false)); vi.unstubAllGlobals() })

// jsdom의 matchMedia는 항상 false → <1024 경로(우측 시트). 데스크톱 팝오버는 AssistantPill.test가 다룬다

it('잘못된 도구 호출은 제안 불가 사유를 표시하고 적용 버튼을 숨긴다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/system-assistant/messages'
    ? Response.json({ text: '확인하세요', toolCalls: [{ id: 'bad', name: 'start_conversation', arguments: '{"assistantName":"FDS","priority":"critical"}' }] })
    : Response.json({ mode: 'mock', model: 'mock' })))
  useUiStore.getState().setAssistantOpen(true)
  renderWithProviders(<AssistantPill />)
  fireEvent.click(screen.getByText(/FDS 작성 도우미로/))
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
  await waitFor(() => expect(signal).toBeDefined())
  fireEvent.click(screen.getByRole('button', { name: '시스템 assistant 닫기' }))
  await waitFor(() => expect(signal?.aborted).toBe(true))
})

it('에이전트 등록 예시와 제안 인자에서 내부 ID를 표시하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/system-assistant/messages'
    ? Response.json({ text: '확인하세요', toolCalls: [{ id: 'create', name: 'create_assistant', arguments: '{"id":"internal-agent-uuid","name":"새 도우미","classifications":[{"level1":"Record","level2":"라벨"}]}' }] })
    : Response.json({ mode: 'mock', model: 'mock' })))
  useUiStore.getState().setAssistantOpen(true)
  renderWithProviders(<AssistantPill />)
  const drawer = screen.getByRole('dialog', { name: '시스템 assistant' }) // Sheet는 portal에 그려져 container 밖이다
  expect(screen.getByRole('button', { name: /에이전트 등록/ })).not.toHaveTextContent('ID')
  fireEvent.click(screen.getByRole('button', { name: /에이전트 등록/ }))
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
  await screen.findByText('남는 답변')
  fireEvent.click(screen.getByTestId('assistant-pill')) // 모달 시트가 열린 동안 바깥은 aria-hidden이라 역할로는 못 찾는다
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'AI 도우미 열기' }))
  expect(await screen.findByText('남는 답변')).toBeInTheDocument()
})
