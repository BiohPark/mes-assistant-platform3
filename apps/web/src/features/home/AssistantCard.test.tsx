import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { Assistant, Locale } from '@mes/contracts'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n'
import { AssistantCard } from './AssistantCard'

const assistant: Assistant = {
  id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2',
  summary: '두 줄을 넘는 긴 요약입니다. '.repeat(8), order: 0, modelId: 'model', link1: 'https://owui.example/?model=model',
  expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: 'var(--primary)', checklistTemplate: [],
  createdBy: 'u', createdAt: '2026-10-01', updatedAt: '2026-10-01', revision: 1,
}
const me = { id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }

function renderCard(override: Partial<Assistant> = {}, locale: Locale = 'ko') {
  const row = { assistant: { ...assistant, ...override }, activeCount: 3, overdueCount: 0, doneCount: 1 }
  return render(
    <MeContext value={me}><I18nProvider locale={locale}><TooltipProvider>
      <MemoryRouter><Routes>
        <Route path="/" element={<AssistantCard row={row} baseUrl="" />} />
        <Route path="/new/:assistantId" element={<div>navigated</div>} />
      </Routes></MemoryRouter>
    </TooltipProvider></I18nProvider></MeContext>,
  )
}

describe('AssistantCard (S9-8 U2)', () => {
  it('does not show expected inputs or outputs on the hub card', () => {
    renderCard({ expectedInputs: ['요구사항 문서'], expectedOutputs: ['분석 결과'] })
    expect(screen.queryByText(/요구사항 문서|분석 결과/)).not.toBeInTheDocument()
    expect(screen.queryByText('입력')).not.toBeInTheDocument()
    expect(screen.queryByText('출력')).not.toBeInTheDocument()
    expect(screen.queryByText('미설정')).not.toBeInTheDocument()
  })
  it('keeps the active count visible while the hover actions are shown', () => {
    renderCard()
    const stats = screen.getByText('3').closest('div')!
    expect(stats.className).not.toMatch(/invisible/)
    const actions = screen.getByRole('link', { name: '대화' }).closest('div')!
    expect(actions).toHaveClass('invisible', 'group-hover:visible', 'group-focus-within:visible')
    expect(actions).not.toHaveClass('absolute')
    expect(actions.parentElement).toBe(stats.parentElement)
    expect(actions.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const link = screen.getByRole('link', { name: 'OpenWebUI' })
    expect(link).toHaveAttribute('href', assistant.link1)
    expect(link).toHaveAttribute('title', 'OpenWebUI에서 열기')
    expect(link.querySelector('svg')).toHaveTextContent('OW')
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(link.querySelector('.lucide-external-link')).toBeNull()
  })

  it('toggles the summary by pointer and keyboard without following the card link', async () => {
    const user = userEvent.setup()
    renderCard()
    const toggle = screen.getByRole('button', { name: '도우미 요약 펼치기' })
    const summary = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(summary).toHaveClass('line-clamp-2')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.closest('a')).toBeNull()
    expect(toggle).toHaveClass('z-10', 'size-8', 'after:-inset-1.5')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAccessibleName('도우미 요약 접기')
    expect(summary).not.toHaveClass('line-clamp-2')
    expect(screen.queryByText('navigated')).toBeNull()
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(summary).toHaveClass('line-clamp-2')
    expect(screen.queryByText('navigated')).toBeNull()
  })

  it('omits the toggle when the agent has no summary', () => {
    renderCard({ summary: '' })
    expect(screen.queryByRole('button', { name: /요약/ })).toBeNull()
  })

  it('labels the toggle and count in English', () => {
    renderCard({}, 'en')
    expect(screen.getByRole('button', { name: 'Expand summary of 도우미' })).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'OpenWebUI' })).toHaveAttribute('title', 'Open in OpenWebUI')
  })

  it('wraps an unbroken long string inside the card when the summary is expanded', async () => {
    const user = userEvent.setup()
    const url = `https://openwebui.example/workspace/models/${'x'.repeat(160)}?model=very-long-model-id`
    renderCard({ summary: url })
    await user.click(screen.getByRole('button', { name: '도우미 요약 펼치기' }))
    const summary = screen.getByText(url)
    expect(summary).not.toHaveClass('line-clamp-2')
    expect(summary).toHaveClass('wrap-anywhere', 'min-w-0')
  })

  it('fits a narrow card and relies on theme tokens only', () => {
    renderCard()
    const toggle = screen.getByRole('button', { name: '도우미 요약 펼치기' })
    expect(toggle.className).not.toMatch(/dark:|#[0-9a-f]{3}/i)
    expect(toggle).toHaveClass('shrink-0')
    const summary = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(summary).toHaveClass('min-w-0')
    const actions = screen.getByRole('link', { name: '대화' }).closest('div')!
    expect(actions).toHaveClass('flex-wrap')
  })
})
