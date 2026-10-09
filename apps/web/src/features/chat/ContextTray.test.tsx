import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { Task } from '@mes/domain'
import { expect, it } from 'vitest'
import { MeContext } from '@/app/auth'
import { ContextTray } from './ContextTray'
import type { RequestEstimateState } from './useRequestEstimate'

const task = { id: 't', threadId: 'h', status: 'in_progress', inputs: [], tags: [], assistantId: 'a' } as unknown as Task
const data: NonNullable<RequestEstimateState['data']> = {
  at: '2026-09-28T00:00:00.000Z', provider: 'mock', transport: 'inline', model: 'mock', bytes: 400, limitBytes: 1000, srCodes: [], overLimit: false, attachmentLimit: 10,
  inputs: [{ kind: 'file', fileId: 'f', name: 'spec.txt', version: 1, weight: 'reference', delivery: 'attached', text: true, bytes: 300 }],
}
const me = { id: 'u', name: '사용자', role: '', roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }

function mount(estimate: RequestEstimateState) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (state: RequestEstimateState) => <QueryClientProvider client={client}><MeContext value={me}><ContextTray task={task} estimate={state} /></MeContext></QueryClientProvider>
  const view = render(tree(estimate))
  return { rerender: (state: RequestEstimateState) => view.rerender(tree(state)) }
}

const tray = () => screen.getByLabelText('이번 요청에 사용할 자료')

it('shows the persist hint and labels × as deselecting the input', () => {
  mount({ data, pending: false, revisionChanged: false })
  expect(screen.getByText('선택한 자료는 이 대화의 다음 요청에도 유지됩니다 · ×로 해제')).toBeVisible()
  expect(screen.getByRole('button', { name: 'spec.txt 입력 선택 해제' })).toBeEnabled()
  expect(screen.getByText('예상 400 B / 1000 B')).toBeVisible()
  expect(tray()).not.toHaveAttribute('aria-busy', 'true')
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
  expect(screen.queryByLabelText('이번 요청에 사용할 자료')).not.toBeInTheDocument()
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
  expect(screen.getByText('이번 요청에 사용 · 0')).toBeVisible()
  expect(screen.getByText('예상 100 B / 1000 B')).toBeVisible()
  expect(screen.queryByText('spec.txt')).not.toBeInTheDocument()
  expect(root).toHaveAttribute('aria-busy', 'false')
})

it('renders a normal empty estimate once data is available', () => {
  mount({ data: { ...data, inputs: [], bytes: 100 }, pending: false, revisionChanged: false })
  expect(tray()).toBeVisible()
  expect(screen.getByText('이번 요청에 사용 · 0')).toBeVisible()
})
