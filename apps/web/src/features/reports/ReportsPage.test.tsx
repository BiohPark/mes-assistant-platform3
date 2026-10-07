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
