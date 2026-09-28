import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { MeContext } from './auth'
import { TopBar } from './TopBar'

const me = { id: 'u1', name: '김운영', role: '', roles: ['member', 'system_owner'] as const }

describe('TopBar', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('로그인 사용자 이름과 SO 표시, 로그아웃', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(204))
    vi.stubGlobal('fetch', fetchMock)
    const afterLogout = vi.fn()
    renderWithProviders(
      <MeContext value={{ ...me, roles: [...me.roles] }}>
        <TooltipProvider>
          <TopBar title="에이전트 허브" onLoggedOut={afterLogout} />
        </TooltipProvider>
      </MeContext>,
    )
    expect(screen.getByText('에이전트 허브')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /김운영/ }))
    expect(await screen.findByText('System Owner')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: '로그아웃' }))
    await waitFor(() => expect(afterLogout).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }))
  })
})
