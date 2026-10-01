import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useUiStore } from '@/app/uiStore'
import { renderWithProviders } from '@/test/render'
import { SystemAssistantDrawer } from './SystemAssistantDrawer'

vi.mock('@/app/hooks', () => ({ useActor: () => ({ userId: 'u' }) }))
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
