import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatBrief as Brief } from '@mes/contracts'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { ChatBrief } from './ChatBrief'

const stats = { questions: 3, participants: [{ id: 'u', name: '사용자' }, { id: 'o', name: '동료' }], startedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }
const ready: Brief = { stats, generating: false, failed: false, stale: false,
  ai: { about: '설비 알람 원인 분석', next: '센서 교체 이력을 확인해 보세요', source: 'ai', model: 'm', basedOnSeq: 4, generatedAt: '2026-10-15T00:00:00.000Z' } }
const serve = (body: unknown, status = 200) => { const fetch = vi.fn(async () => jsonResponse(status, body)); vi.stubGlobal('fetch', fetch); return fetch }
afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem('mes-chat-brief-collapsed') })

it('starts collapsed (S14) and expands to the AI topic, the server-counted progress and the AI next step', async () => {
  const fetch = serve(ready)
  renderWithProviders(<ChatBrief taskId="t1" />)
  const toggle = await screen.findByRole('button', { name: /AI 요약·제안/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('설비 알람 원인 분석')).not.toBeInTheDocument()
  fireEvent.click(toggle)
  expect(screen.getByText('설비 알람 원인 분석')).toBeInTheDocument()
  expect(screen.getByText('질문 3회 · 참여 사용자, 동료 · 3일 전 시작')).toBeInTheDocument()
  expect(screen.getByText('센서 교체 이력을 확인해 보세요')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /AI 요약·제안/ })).toHaveAttribute('aria-expanded', 'true')
  expect(fetch).toHaveBeenCalledWith('/api/tasks/t1/brief', expect.anything())
})

it('keeps the screen usable while generating or after a failure — the counted line still shows', async () => {
  localStorage.setItem('mes-chat-brief-collapsed', '0')
  serve({ stats, generating: true, failed: false, stale: false })
  const { unmount } = renderWithProviders(<ChatBrief taskId="t2" />)
  expect(await screen.findByText('AI가 요약을 만드는 중…')).toBeInTheDocument()
  expect(screen.getByText(/질문 3회/)).toBeInTheDocument()
  unmount()
  serve({ stats, generating: false, failed: true, stale: false })
  renderWithProviders(<ChatBrief taskId="t3" />)
  expect(await screen.findByText('AI 요약을 만들지 못했습니다. 다음에 들어올 때 다시 시도합니다.')).toBeInTheDocument()
})

it('marks a rule-based (mock) card and an older card being refreshed', async () => {
  localStorage.setItem('mes-chat-brief-collapsed', '0')
  serve({ ...ready, generating: true, stale: true, ai: { ...ready.ai!, source: 'rule' } })
  renderWithProviders(<ChatBrief taskId="t4" />)
  expect(await screen.findByText(/규칙 판단/)).toBeInTheDocument()
  expect(screen.getByText('새 메시지 반영 중…')).toBeInTheDocument()
})

it('remembers the expanded/collapsed choice across conversations', async () => {
  serve(ready)
  const { unmount } = renderWithProviders(<ChatBrief taskId="t5" />)
  fireEvent.click(await screen.findByRole('button', { name: /AI 요약·제안/ }))
  expect(screen.getByText('설비 알람 원인 분석')).toBeInTheDocument()
  expect(localStorage.getItem('mes-chat-brief-collapsed')).toBe('0')
  unmount()
  const second = renderWithProviders(<ChatBrief taskId="t6" />)
  expect(await screen.findByRole('button', { name: /AI 요약·제안/ })).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(screen.getByRole('button', { name: /AI 요약·제안/ }))
  expect(localStorage.getItem('mes-chat-brief-collapsed')).toBe('1')
  second.unmount()
  renderWithProviders(<ChatBrief taskId="t9" />)
  expect(await screen.findByRole('button', { name: /AI 요약·제안/ })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('설비 알람 원인 분석')).not.toBeInTheDocument()
})

it('renders nothing for an empty conversation or when the brief cannot load', async () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  const fetch = serve({ stats: { ...stats, questions: 0, participants: [] }, generating: false, failed: false, stale: false })
  const { unmount } = renderWithProviders(<ChatBrief taskId="t7" />)
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  await settle()
  expect(screen.queryByTestId('chat-brief')).not.toBeInTheDocument()
  unmount()
  const broken = serve([])
  renderWithProviders(<ChatBrief taskId="t8" />)
  await waitFor(() => expect(broken).toHaveBeenCalled())
  await settle()
  expect(screen.queryByTestId('chat-brief')).not.toBeInTheDocument()
})
