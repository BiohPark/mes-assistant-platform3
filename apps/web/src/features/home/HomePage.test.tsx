import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MeContext } from '@/app/auth'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { HomePage } from './HomePage'

describe('HomePage (S0 빈 허브)', () => {
  it('에이전트가 아직 없다는 빈 상태를 보여 준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
    renderWithProviders(
      <MeContext value={{ id: 'u1', name: '이담당', role: '', roles: ['member'] }}>
        <TooltipProvider>
          <HomePage />
        </TooltipProvider>
      </MeContext>,
    )
    expect(screen.getByRole('heading', { name: '에이전트 허브' })).toBeInTheDocument()
    expect(await screen.findByText('등록된 에이전트가 없습니다')).toBeInTheDocument()
  })
})
