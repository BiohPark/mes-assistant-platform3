import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MeContext } from '@/app/auth'
import { renderWithProviders } from '@/test/render'
import { HomePage } from './HomePage'

describe('HomePage (S0 빈 허브)', () => {
  it('에이전트가 아직 없다는 빈 상태를 보여 준다', () => {
    renderWithProviders(
      <MeContext value={{ id: 'u1', name: '이담당', role: '', roles: ['member'] }}>
        <TooltipProvider>
          <HomePage />
        </TooltipProvider>
      </MeContext>,
    )
    expect(screen.getByRole('heading', { name: '에이전트 허브' })).toBeInTheDocument()
    expect(screen.getByText('등록된 에이전트가 없습니다')).toBeInTheDocument()
  })
})
