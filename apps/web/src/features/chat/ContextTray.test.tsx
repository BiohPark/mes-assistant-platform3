import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { Task } from '@mes/domain'
import { beforeEach, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { MeContext } from '@/app/auth'
import { ContextTray } from './ContextTray'
import { resetBubbles, useBubbleStore } from '@/features/assistant-pill/bubbles'
import type { RequestEstimateState } from './useRequestEstimate'

const task = { id: 't', threadId: 'h', status: 'in_progress', inputs: [], tags: [], assistantId: 'a' } as unknown as Task
const data: NonNullable<RequestEstimateState['data']> = {
  at: '2026-09-28T00:00:00.000Z', provider: 'mock', transport: 'inline', model: 'mock', bytes: 400, limitBytes: 1000, srCodes: [], srs: [], overLimit: false, attachmentLimit: 10,
  inputs: [{ kind: 'file', fileId: 'f', name: 'spec.txt', version: 1, weight: 'reference', delivery: 'attached', text: true, bytes: 300 }],
}
const me = { id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }

function mount(estimate: RequestEstimateState, locale: 'ko' | 'en' = 'ko') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (state: RequestEstimateState) => <QueryClientProvider client={client}><MeContext value={me}><I18nProvider locale={locale}><ContextTray task={task} estimate={state} /></I18nProvider></MeContext></QueryClientProvider>
  const view = render(tree(estimate))
  return { rerender: (state: RequestEstimateState) => view.rerender(tree(state)) }
}

const tray = () => screen.getByLabelText('AI에 함께 보내는 자료')

beforeEach(() => resetBubbles())

it.each([
  { locale: 'ko' as const, label: 'AI에 함께 보내는 자료', hint: '이 대화의 다음 질문에도 함께 갑니다 · ×로 빼기', remove: 'spec.txt 입력 선택 해제', estimate: '예상 400 B / 1000 B' },
  { locale: 'en' as const, label: 'Materials sent to AI', hint: 'Included with your next questions in this conversation · Remove with ×', remove: 'Deselect spec.txt as input', estimate: 'Est. 400 B / 1000 B' },
])('shows the AI materials count and persist hint ($locale)', ({ locale, label, hint, remove, estimate }) => {
  mount({ data, pending: false, revisionChanged: false }, locale)
  expect(screen.getByRole('button', { name: `${label} · 1` })).toBeVisible()
  expect(screen.getByText(hint)).toBeVisible()
  expect(screen.getByRole('button', { name: remove })).toBeEnabled()
  expect(screen.getByText(estimate)).toBeVisible()
  expect(screen.getByLabelText(label)).not.toHaveAttribute('aria-busy', 'true')
})

it('keeps the list and shows "calculating" while a draft change is pending', () => {
  const { rerender } = mount({ data, pending: false, revisionChanged: false })
  const root = tray()
  const meter = screen.getByRole('meter')
  rerender({ data, pending: true, revisionChanged: false })
  expect(tray()).toBe(root)
  expect(root).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByText('계산 중')).toBeVisible()
  expect(screen.queryByText(/^예상 /)).not.toBeInTheDocument()
  expect(screen.getByText('spec.txt')).toBeVisible()
  expect(screen.getByRole('list')).not.toHaveClass('opacity-60')
  expect(screen.getByRole('meter')).toBe(meter)
  expect(meter.firstElementChild).toHaveStyle({ width: '40%' })
})

it('dims the list but keeps ★/× active while a revision change is pending', () => {
  const { rerender } = mount({ data, pending: false, revisionChanged: false })
  const root = tray()
  rerender({ data, pending: true, revisionChanged: true })
  expect(tray()).toBe(root)
  const list = screen.getByRole('list')
  expect(list).toHaveAttribute('aria-busy', 'true')
  expect(list).toHaveClass('opacity-60')
  expect(screen.getByRole('button', { name: 'spec.txt 주 입력 전환' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'spec.txt 입력 선택 해제' })).toBeEnabled()
  rerender({ data: { ...data, bytes: 100 }, pending: false, revisionChanged: false })
  expect(tray()).toBe(root)
  expect(screen.getByRole('list')).not.toHaveClass('opacity-60')
  expect(screen.getByText('예상 100 B / 1000 B')).toBeVisible()
})

it('renders nothing before the first estimate arrives', () => {
  mount({ data: undefined, pending: true, revisionChanged: false })
  expect(screen.queryByLabelText('AI에 함께 보내는 자료')).not.toBeInTheDocument()
})

it('keeps the tray and meter mounted after the last input is removed', () => {
  const { rerender } = mount({ data, pending: false, revisionChanged: false })
  const root = tray()
  const meter = screen.getByRole('meter')
  rerender({ data, pending: true, revisionChanged: true })
  expect(tray()).toBe(root)
  rerender({ data: { ...data, inputs: [], bytes: 100 }, pending: false, revisionChanged: false })
  expect(tray()).toBe(root)
  expect(screen.getByRole('meter')).toBe(meter)
  expect(screen.getByText('AI에 함께 보내는 자료 · 0')).toBeVisible()
  expect(screen.getByText('예상 100 B / 1000 B')).toBeVisible()
  expect(screen.queryByText('spec.txt')).not.toBeInTheDocument()
  expect(root).toHaveAttribute('aria-busy', 'false')
})

it('lists the SR bodies that will actually be included, from the estimate (same assembly as sending)', () => {
  const { rerender } = mount({ data: { ...data, srCodes: ['SR-2026-0001', 'SR-2026-0404'], srs: [{ code: 'SR-2026-0001', title: '알람 필터' }] }, pending: false, revisionChanged: false })
  expect(screen.getByText('SR 본문 포함 · 1')).toBeVisible()
  const list = screen.getByRole('list', { name: '이번 요청에 포함될 SR 본문' })
  expect(list).toHaveTextContent('SR-2026-0001')
  expect(list).toHaveTextContent('알람 필터')
  // 미접수 번호(SR-2026-0404)는 본문이 없으므로 포함 목록에 없다
  expect(list).not.toHaveTextContent('SR-2026-0404')
  rerender({ data, pending: false, revisionChanged: false })
  expect(screen.queryByText(/^SR 본문 포함/)).not.toBeInTheDocument()
})

it('renders a normal empty estimate once data is available', () => {
  mount({ data: { ...data, inputs: [], bytes: 100 }, pending: false, revisionChanged: false })
  expect(tray()).toBeVisible()
  expect(screen.getByText('AI에 함께 보내는 자료 · 0')).toBeVisible()
})

it('collapses to summary chips (files · conversations · SR) and expands back to the full list', () => {
  const conversationInput = { kind: 'conversation' as const, sourceTaskId: 's', code: 'WK-2026-0002', title: '원본', assistantName: 'A', mode: 'full' as const, weight: 'reference' as const, snapshotId: 'snap', messageCount: 3, bytes: 50 }
  mount({ data: { ...data, inputs: [...data.inputs, conversationInput], srs: [{ code: 'SR-2026-0001', title: '알람 필터' }] }, pending: false, revisionChanged: false })
  expect(screen.queryByRole('list', { name: '담긴 자료 요약' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /AI에 함께 보내는 자료 · 2/ }))
  expect(screen.queryByText('spec.txt')).not.toBeInTheDocument()
  const chips = screen.getByRole('list', { name: '담긴 자료 요약' })
  expect(within(chips).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['파일 1', '대화 1', 'SR 1'])
  expect(screen.getByRole('meter')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /AI에 함께 보내는 자료 · 2/ }))
  expect(screen.getByText('spec.txt')).toBeVisible()
  expect(screen.queryByRole('list', { name: '담긴 자료 요약' })).not.toBeInTheDocument()
})

it('pushes an assistant bubble once when the budget level rises, and its click expands the tray and focuses the toggle', () => {
  const { rerender } = mount({ data: { ...data, bytes: 400 }, pending: false, revisionChanged: false })
  expect(useBubbleStore.getState().current).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /AI에 함께 보내는 자료 · 1/ })) // 접어 둔다
  expect(screen.getByRole('button', { name: /AI에 함께 보내는 자료 · 1/ })).toHaveAttribute('aria-expanded', 'false')
  rerender({ data: { ...data, bytes: 850 }, pending: false, revisionChanged: false }) // > 80% → warn
  rerender({ data: { ...data, bytes: 900 }, pending: false, revisionChanged: false }) // 같은 레벨 — 추가 없음
  expect(useBubbleStore.getState().current).toMatchObject({ source: 'budget.warn' })
  expect(useBubbleStore.getState().queued).toBeNull()
  act(() => useBubbleStore.getState().current?.onOpen?.())
  const toggle = screen.getByRole('button', { name: /AI에 함께 보내는 자료 · 1/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(toggle).toHaveFocus()
  rerender({ data: { ...data, bytes: 1200 }, pending: false, revisionChanged: false }) // over — 한 번 더
  expect(useBubbleStore.getState().queued).toMatchObject({ source: 'budget.over' })
})
