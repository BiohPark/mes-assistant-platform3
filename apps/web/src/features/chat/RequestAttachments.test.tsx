import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Task } from '@mes/domain'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { MeContext } from '@/app/auth'
import { Composer } from './Composer'
import { RequestSizeNotice, useRequestAttachments } from './RequestAttachments'
import { resetBubbles, useBubbleStore } from '@/features/assistant-pill/bubbles'
import type { RequestEstimateState } from './useRequestEstimate'

const task = { id: 't', threadId: 'h', status: 'in_progress', inputs: [], tags: [], assistantId: 'a' } as unknown as Task
const file = { kind: 'file' as const, fileId: 'f', name: 'spec.txt', version: 2, weight: 'reference' as const, delivery: 'attached' as const, text: true, bytes: 300 }
const conversation = { kind: 'conversation' as const, sourceTaskId: 's', code: 'WK-2026-0002', title: '원본 대화', assistantName: 'A', mode: 'summary' as const, weight: 'main' as const, snapshotId: 'snap', messageCount: 3, bytes: 50 }
const sr = { kind: 'sr' as const, srId: 'sr1', code: 'SR-2026-0001', title: '알람 필터', weight: 'reference' as const, bytes: 40 }
const data: NonNullable<RequestEstimateState['data']> = {
  at: '2026-09-28T00:00:00.000Z', provider: 'mock', transport: 'inline', model: 'mock', bytes: 400, limitBytes: 1000, srCodes: ['SR-2026-0009'], srs: [{ code: 'SR-2026-0009', title: '연결만 된 SR' }], overLimit: false, attachmentLimit: 10, inputSignature: 'a'.repeat(64),
  inputs: [file, conversation, sr],
}
const me = { id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }
const calls: Array<[string, string]> = []

function Harness({ estimate, target = task }: { estimate: RequestEstimateState; target?: Task }) {
  return <Composer inputLabels streaming={false} onSend={async () => undefined} onStop={() => undefined} attachments={useRequestAttachments(target, estimate)} notice={<RequestSizeNotice task={target} estimate={estimate} />} />
}
function mount(estimate: RequestEstimateState, { locale = 'ko', target = task }: { locale?: 'ko' | 'en'; target?: Task } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (state: RequestEstimateState) => <QueryClientProvider client={client}><MeContext value={me}><I18nProvider locale={locale}><Harness estimate={state} target={target} /></I18nProvider></MeContext></QueryClientProvider>
  const view = render(tree(estimate))
  return { rerender: (state: RequestEstimateState) => view.rerender(tree(state)) }
}

beforeEach(() => {
  resetBubbles(); calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push([url, init?.method ?? 'GET']); return new Response(null, { status: 204 }) }))
})
afterEach(() => vi.unstubAllGlobals())

it('추정(보낼 것)의 파일·대화·SR 본문이 입력창 칩으로 보이고 ×·★가 각자의 경로로 간다 — 연결 메타(srs)는 칩이 아니다', async () => {
  mount({ data, pending: false, revisionChanged: false })
  const row = screen.getByRole('list', { name: '첨부' })
  expect(Array.from(row.children).map(item => item.textContent)).toEqual(['spec.txt', 'WK-2026-0002', 'SR-2026-0001'])
  expect(row.children[0]).toHaveAttribute('title', 'spec.txt v2 · 파일 첨부')
  expect(row.children[1]).toHaveAttribute('title', '원본 대화 · 요약')
  expect(row.children[2]).toHaveAttribute('title', '알람 필터')
  expect(row).not.toHaveTextContent('SR-2026-0009')
  expect(screen.queryByText(/SR 본문 포함/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'WK-2026-0002 주 입력 전환' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: 'SR-2026-0001 주 입력 전환' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'spec.txt 주 입력 전환' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'spec.txt 첨부 빼기' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'spec.txt 첨부 빼기' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'WK-2026-0002 첨부 빼기' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'WK-2026-0002 첨부 빼기' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'SR-2026-0001 첨부 빼기' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'SR-2026-0001 첨부 빼기' }))
  await waitFor(() => expect(calls).toEqual(expect.arrayContaining([
    ['/api/tasks/t/inputs/f', 'PUT'], ['/api/tasks/t/inputs/f', 'DELETE'], ['/api/tasks/t/conversation-inputs/s', 'DELETE'], ['/api/tasks/t/sr-inputs/sr1', 'DELETE'],
  ])))
})

it('완료된 대화는 칩을 막고, 새 추정을 기다리는 동안 칩을 흐리게 두되 누를 수 있다', () => {
  const { rerender } = mount({ data, pending: false, revisionChanged: false }, { target: { ...task, status: 'done' } })
  expect(screen.getByRole('button', { name: 'spec.txt 첨부 빼기' })).toBeDisabled()
  rerender({ data, pending: true, revisionChanged: true })
  expect(screen.getAllByRole('listitem')[0]).toHaveClass('opacity-60')
})

it('요청 크기는 한도 근처에서만 작게 보인다(ok 숨김 · warn 안내 · 계산 중)', () => {
  const { rerender } = mount({ data, pending: false, revisionChanged: false })
  expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  rerender({ data: { ...data, bytes: 850 }, pending: false, revisionChanged: false })
  const notice = screen.getByRole('status')
  expect(notice).toHaveTextContent('요청 크기가 한도에 가까워요')
  expect(notice).toHaveTextContent('850 B / 1000 B')
  expect(within(notice).getByRole('meter', { name: '요청 크기' })).toHaveAttribute('aria-valuenow', '850')
  rerender({ data: { ...data, bytes: 850 }, pending: true, revisionChanged: false })
  expect(screen.getByRole('status')).toHaveTextContent('계산 중')
  expect(screen.getByRole('status')).not.toHaveTextContent('850 B / 1000 B')
})

it('한도를 넘으면 경고와 조절 동작(빼기·범위·요약·새 대화)을 보인다', async () => {
  mount({ data: { ...data, bytes: 1200, overLimit: true }, pending: false, revisionChanged: false })
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('요청 크기 한도를 넘어 보낼 수 없습니다.')
  expect(alert).toHaveTextContent('1.2 KB / 1000 B')
  expect(within(alert).getByRole('link', { name: '새 대화로 이어가기' })).toHaveAttribute('href', '/new/a?ref=t')
  expect(within(alert).getByRole('button', { name: '메시지 범위 선택' })).toBeEnabled()
  expect(within(alert).getByRole('button', { name: '요약 만들기' })).toBeEnabled()
  fireEvent.click(within(alert).getByRole('button', { name: '입력 해제' }))
  await waitFor(() => expect(calls).toContainEqual(['/api/tasks/t/inputs/f', 'DELETE']))
})

it('영어 화면도 같은 칩·안내를 쓴다', () => {
  mount({ data: { ...data, bytes: 850 }, pending: false, revisionChanged: false }, { locale: 'en' })
  expect(screen.getByRole('list', { name: 'Attachments' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove spec.txt attachment' })).toBeEnabled()
  expect(screen.getByRole('status')).toHaveTextContent('The request is close to the size limit')
})

it('레벨이 오를 때 도우미 말풍선을 한 번 띄우고, 누르면 크기 안내로 포커스한다', () => {
  const { rerender } = mount({ data, pending: false, revisionChanged: false })
  expect(useBubbleStore.getState().current).toBeNull()
  rerender({ data: { ...data, bytes: 850 }, pending: false, revisionChanged: false }) // > 80% → warn
  rerender({ data: { ...data, bytes: 900 }, pending: false, revisionChanged: false }) // 같은 레벨 — 추가 없음
  expect(useBubbleStore.getState().current).toMatchObject({ source: 'budget.warn' })
  expect(useBubbleStore.getState().queued).toBeNull()
  act(() => useBubbleStore.getState().current?.onOpen?.())
  expect(screen.getByRole('status')).toHaveFocus()
  rerender({ data: { ...data, bytes: 1200 }, pending: false, revisionChanged: false }) // over — 한 번 더
  expect(useBubbleStore.getState().queued).toMatchObject({ source: 'budget.over' })
})

it('shows the full-mode size of attached conversations and points to the brief mode when over the limit', async () => {
  const { useUiStore } = await import('@/app/uiStore')
  useUiStore.setState({ answerDetails: { u: 'full' } })
  try {
    const full = { ...conversation, mode: 'full' as const, bytes: 2048 }
    const { rerender } = mount({ data: { ...data, inputs: [full] }, pending: false, revisionChanged: false })
    expect(screen.getByTestId('answer-detail-notice')).toHaveTextContent('전체 모드 — 도구 원문 포함 2.0 KB')
    rerender({ data: { ...data, inputs: [full], bytes: 2000, overLimit: true }, pending: false, revisionChanged: false })
    expect(screen.getByRole('alert')).toHaveTextContent('생각·답변만 모드로 전환하면 도구 입출력을 제외해 용량을 줄일 수 있습니다')
    act(() => useUiStore.setState({ answerDetails: { u: 'brief' } }))
    expect(screen.queryByTestId('answer-detail-notice')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).not.toHaveTextContent('생각·답변만 모드로 전환하면')
  } finally { act(() => useUiStore.setState({ answerDetails: {} })) }
})

