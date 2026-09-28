import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { useUiStore } from '@/app/uiStore'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { HomePage } from './HomePage'

const base = { level1CodeId: 'assistant_level1:SDLC', level2CodeId: 'assistant_level2:분석', summary: '문서 분석', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'seed-system', status: 'open', usageExample: '', color: '#2563eb', checklistTemplate: [], createdBy: 'seed-system', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', revision: 0 }
const items = [
  { ...base, id: 'a', name: '분석 도우미', level1: 'SDLC', level2: '분석' },
  { ...base, id: 'b', name: '기록 도우미', level1: 'Record', level2: 'Deviation', order: 2 },
  { ...base, id: 'c', name: '중단 도우미', level1: 'SDLC', level2: '분석', status: 'retired', order: 3 },
]

beforeEach(() => {
  useUiStore.setState({ homeFilters: { q: '', level1: null, level2: null, showRetired: false } })
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input === '/api/assistants') return jsonResponse(200, items)
    if (input === '/api/assistants/stats') return jsonResponse(200, items.map((item) => ({ assistantId: item.id, open: 0, inProgress: 0, onHold: 0, done: 0 })))
    if (input === '/api/users') return jsonResponse(200, [])
    return jsonResponse(404)
  }))
})

function renderHome() {
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><TooltipProvider><HomePage /></TooltipProvider></MeContext>)
}

describe('HomePage catalog', () => {
  it('renders seeded cards in order and hides retired by default', async () => {
    renderHome()
    await waitFor(() => expect(screen.getAllByRole('link', { name: /새 대화/ })).toHaveLength(2))
    expect(screen.getByText('분석 도우미')).toBeInTheDocument()
    expect(screen.queryByText('중단 도우미')).not.toBeInTheDocument()
  })

  it('filters by search and Lv1, then can include retired', async () => {
    const user = userEvent.setup()
    renderHome()
    await screen.findByText('분석 도우미')
    await user.type(screen.getByPlaceholderText('이름 · 요약 · 업무 분류 검색'), '기록')
    expect(screen.getByText('기록 도우미')).toBeInTheDocument()
    expect(screen.queryByText('분석 도우미')).not.toBeInTheDocument()
    await user.clear(screen.getByPlaceholderText('이름 · 요약 · 업무 분류 검색'))
    await user.click(screen.getByRole('radio', { name: 'SDLC' }))
    expect(screen.getByText('분석 도우미')).toBeInTheDocument()
    expect(screen.queryByText('기록 도우미')).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: '폐기 표시' }))
    expect(screen.getByText('중단 도우미')).toBeInTheDocument()
  })
})
