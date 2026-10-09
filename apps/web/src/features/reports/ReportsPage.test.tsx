import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { ReportsPage } from './ReportsPage'

vi.mock('@/app/NotificationBell', () => ({ NotificationBell: () => null }))
afterEach(() => vi.unstubAllGlobals())

it('8개 섹션을 보여주고 기간·단위 변경 시 서버에 다시 요청한다', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/reports?')) {
      calls.push(url)
      const bucketCount = url.includes('days=7&granularity=day') ? 7 : 5
      return jsonResponse(200, { kpi: { done: 0, reopens: 0 }, buckets: Array.from({ length: bucketCount }, (_, index) => ({ key: String(index), label: String(index), done: 0 })), assistantStats: [], userStats: [], flow: [], tags: [],
        srDist: [], signals: [], digest: [], assistants: [], users: [] })
    }
    return jsonResponse(404)
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><ReportsPage /></TooltipProvider></MeContext>)
  for (const title of ['완료 추이', '에이전트별 평균 리드타임', '사용자별 활동', 'SR 상태 분포', '자료 흐름', '태그별 대화', '에이전트별 현황', 'assistant 피드백 다이제스트']) {
    expect(await screen.findByRole('heading', { name: new RegExp(title) })).toBeInTheDocument()
  }
  await userEvent.click(screen.getByRole('button', { name: '7일' }))
  await userEvent.click(screen.getByRole('button', { name: /^일$/ }))
  expect(calls).toContain('/api/reports?days=7&granularity=day')
  await waitFor(() => expect(screen.getByRole('img', { name: '완료 업무' }).children).toHaveLength(7))
})

it('Popover 담당자 검색·키보드 선택과 전체 해제는 서버 필터를 갱신한다', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/reports?')) { calls.push(url); return jsonResponse(200, {
      kpi: { done: 0, reopens: 0 }, buckets: [], assistantStats: [], userStats: [], flow: [], tags: [], srDist: [], signals: [], digest: [], assistants: [], users: [{ id: 'other', name: '다른 사람' }],
    }) }
    return jsonResponse(404)
  }))
  const user = userEvent.setup()
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><ReportsPage /></TooltipProvider></MeContext>)
  const filter = await screen.findByRole('button', { name: '담당자: 전체' })
  filter.focus(); await user.keyboard('{Enter}')
  const picker = screen.getByRole('combobox', { name: '담당자' })
  await user.type(picker, '다른')
  await screen.findByRole('option', { name: '다른 사람' })
  await user.keyboard('{ArrowDown}{Enter}')
  await waitFor(() => expect(calls).toContain('/api/reports?days=30&granularity=week&userId=other'))
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: '담당자: 다른 사람' }))
  await user.click(screen.getByRole('button', { name: '전체' }))
  expect(screen.getByRole('button', { name: '담당자: 전체' })).toHaveAttribute('aria-pressed', 'false')
  await waitFor(() => expect(calls.at(-1)).toBe('/api/reports?days=30&granularity=week'))
})

it('uses semantic foregrounds for SR progress, warning signals and feedback icons', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/reports?') ? jsonResponse(200, {
    kpi: { done: 0, reopens: 0 }, buckets: [], assistantStats: [], userStats: [], flow: [], tags: [],
    srDist: [{ status: 'reviewing', count: 2 }, { status: 'submitted', count: 1 }],
    signals: [{ kind: 'reopen', taskId: 't', taskCode: 'WK-2026-0001', taskTitle: '대화', detail: '재개 사유', at: '2026-10-01T00:00:00.000Z' }],
    digest: [{ assistantId: 'a', assistantName: '도우미', avgRating: 4, count: 1, comments: [] }],
    assistants: [], users: [],
  }) : jsonResponse(404)))
  const { container } = renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><ReportsPage /></TooltipProvider></MeContext>)
  await screen.findByText('재개 사유')
  const bars = container.querySelectorAll('div.h-full')
  expect(bars).toHaveLength(2)
  expect(bars[0]).toHaveClass('bg-tone-info-fg')
  expect(bars[1]).toHaveClass('bg-tone-info-fg')
  expect(bars[0]).toHaveStyle({ width: `${2 / 3 * 100}%` })
  expect(bars[1]).toHaveStyle({ width: `${1 / 3 * 100}%` })
  expect(container.querySelector('svg.lucide-triangle-alert')).toHaveClass('text-tone-warning-fg')
  expect(container.querySelector('svg.lucide-star')).toHaveClass('text-tone-warning-fg')
})
