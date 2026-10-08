import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { TopBar } from '@/app/TopBar'
import { useUiStore } from '@/app/uiStore'
import { TooltipProvider } from '@/components/ui/tooltip'
import { renderWithProviders } from '@/test/render'
import { SystemAssistantDrawer } from './SystemAssistantDrawer'

vi.mock('@/app/hooks', () => ({ useActor: () => ({ userId: 'u' }) }))
vi.mock('@/app/NotificationBell', () => ({ NotificationBell: () => null }))
afterEach(() => { act(() => useUiStore.getState().setAssistantOpen(false)); vi.unstubAllGlobals() })

it('잘못된 도구 호출은 제안 불가 사유를 표시하고 적용 버튼을 숨긴다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/system-assistant/model'
    ? Response.json({ mode: 'mock', model: 'mock' })
    : Response.json({ text: '확인하세요', toolCalls: [{ id: 'bad', name: 'start_conversation', arguments: '{"assistantName":"FDS","priority":"critical"}' }] })))
  useUiStore.getState().setAssistantOpen(true)
  renderWithProviders(<SystemAssistantDrawer />)
  fireEvent.click(screen.getByText(/FDS 작성 도우미로/))
  await waitFor(() => expect(screen.getByText('제안 불가')).toBeInTheDocument())
  expect(screen.getByRole('alert')).toHaveTextContent('priority')
  expect(screen.queryByRole('button', { name: '적용' })).not.toBeInTheDocument()
})

it('서랍을 닫으면 진행 중인 요청의 신호를 중단한다', async () => {
  let signal: AbortSignal | undefined
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/system-assistant/model') return Response.json({ mode: 'mock', model: 'mock' })
    signal = init?.signal as AbortSignal
    return new Promise<Response>(() => undefined)
  }))
  useUiStore.getState().setAssistantOpen(true)
  renderWithProviders(<SystemAssistantDrawer />)
  fireEvent.click(screen.getByText(/FDS 작성 도우미로/))
  await waitFor(() => expect(signal).toBeDefined())
  fireEvent.click(screen.getByRole('button', { name: '시스템 assistant 닫기' }))
  await waitFor(() => expect(signal?.aborted).toBe(true))
})


it('에이전트 등록 예시와 제안 인자에서 내부 ID를 표시하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/system-assistant/model'
    ? Response.json({ mode: 'mock', model: 'mock' })
    : Response.json({ text: '확인하세요', toolCalls: [{ id: 'create', name: 'create_assistant', arguments: '{"id":"internal-agent-uuid","name":"새 도우미","classifications":[{"level1":"Record","level2":"라벨"}]}' }] })))
  useUiStore.getState().setAssistantOpen(true)
  renderWithProviders(<SystemAssistantDrawer />)
  const drawer = screen.getByRole('dialog', { name: '시스템 assistant' }) // Sheet는 portal에 그려져 container 밖이다
  expect(screen.getByRole('button', { name: /에이전트 등록/ })).not.toHaveTextContent('ID')
  fireEvent.click(screen.getByRole('button', { name: /에이전트 등록/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: '적용' })).toBeInTheDocument())
  fireEvent.click(screen.getByText('인자 보기'))
  expect(drawer).not.toHaveTextContent('internal-agent-uuid')
  expect(drawer.querySelector('pre')).toHaveTextContent('새 도우미')
})

it('서랍은 이름 있는 dialog로 열리고 Esc로 닫힌다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ mode: 'mock', model: 'mock' })))
  useUiStore.getState().setAssistantOpen(true)
  renderWithProviders(<SystemAssistantDrawer />)
  const dialog = screen.getByRole('dialog', { name: '시스템 assistant' })
  expect(dialog).toHaveAttribute('data-slot', 'sheet-content')
  expect(dialog).toHaveAttribute('data-side', 'right')
  expect(screen.getByRole('button', { name: '시스템 assistant 닫기' })).toBeInTheDocument()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(useUiStore.getState().assistantOpen).toBe(false))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '시스템 assistant' })).not.toBeInTheDocument())
})

it('TopBar 버튼으로 연 서랍을 닫으면 포커스가 그 버튼으로 돌아간다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ mode: 'mock', model: 'mock' })))
  const me = { id: 'u', name: '사용자', role: '', roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }
  renderWithProviders(<MeContext value={me}><TooltipProvider><TopBar /><SystemAssistantDrawer /></TooltipProvider></MeContext>)
  const opener = screen.getByRole('button', { name: '시스템 assistant 열기' })
  opener.focus()
  fireEvent.click(opener)
  const dialog = await screen.findByRole('dialog', { name: '시스템 assistant' })
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '시스템 assistant' })).not.toBeInTheDocument())
  expect(opener).toHaveFocus()
})
