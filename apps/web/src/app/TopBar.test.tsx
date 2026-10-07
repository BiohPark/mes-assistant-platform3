import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { AuthGate } from './AuthGate'
import { MeContext } from './auth'
import { TopBar } from './TopBar'
import { useProfile } from './profile'

vi.mock('./NotificationBell', () => ({ NotificationBell: () => null }))

const me = { theme: 'system' as const, locale: 'ko' as const, id: 'u1', name: '김운영', role: '', roles: ['member', 'system_owner'] as const }

function ProfileState() {
  const profile = useProfile()
  return <output aria-label="프로필 상태">{profile.theme}·{profile.locale}</output>
}

describe('TopBar', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.className = ''; document.documentElement.lang = 'ko' })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('로그인 사용자 이름과 SO 표시, 로그아웃', async () => {
    const fetchMock = vi.fn(async (url: string) => url === '/api/llm/status' ? jsonResponse(200, { mode: 'mock', preset: 'openwebui', baseUrlHost: '', ok: true, detail: 'Mock' }) : jsonResponse(204))
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
    expect(await screen.findByText('Mock')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /김운영/ }))
    expect(await screen.findByText('System Owner')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: '로그아웃' }))
    await waitFor(() => expect(afterLogout).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }))
  })

  it.each([204, 500])('로그아웃 응답 %s에서 성공한 경우에만 화면·두 캐시를 system·ko로 초기화한다', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/me'
      ? jsonResponse(200, { ...me, roles: ['member'], theme: 'dark', locale: 'en' })
      : jsonResponse(status)))
    const afterLogout = vi.fn(() => ({ theme: localStorage.getItem('mes-theme'), locale: localStorage.getItem('mes-locale') }))
    renderWithProviders(<AuthGate><TooltipProvider><TopBar onLoggedOut={afterLogout} /><ProfileState /></TooltipProvider></AuthGate>)
    await screen.findByRole('button', { name: /김운영/ })
    await waitFor(() => expect(screen.getByLabelText('프로필 상태')).toHaveTextContent('dark·en'))
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.lang).toBe('en')
    await userEvent.click(screen.getByRole('button', { name: /김운영/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '로그아웃' }))
    const theme = status === 204 ? 'system' : 'dark'
    const locale = status === 204 ? 'ko' : 'en'
    await waitFor(() => expect(screen.getByLabelText('프로필 상태')).toHaveTextContent(`${theme}·${locale}`))
    expect(localStorage.getItem('mes-theme')).toBe(theme)
    expect(localStorage.getItem('mes-locale')).toBe(locale)
    expect(document.documentElement.classList.contains('dark')).toBe(status !== 204)
    expect(document.documentElement.lang).toBe(locale)
    expect(afterLogout).toHaveBeenCalledTimes(status === 204 ? 1 : 0)
    if (status === 204) expect(afterLogout.mock.results[0]?.value).toEqual({ theme: 'system', locale: 'ko' })
  })

  it('테마·언어 메뉴는 즉시 적용하고 서버에 저장한다', async () => {
    let server = { ...me, roles: ['member'], theme: 'system', locale: 'ko' }
    let finish!: (response: Response) => void
    const fetchMock = vi.fn((url: string) => url === '/api/me' ? Promise.resolve(jsonResponse(200, server)) : new Promise<Response>((resolve) => { finish = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AuthGate><TooltipProvider><TopBar /></TooltipProvider></AuthGate>)
    await screen.findByRole('button', { name: /김운영/ })
    await userEvent.click(screen.getByRole('button', { name: /김운영/ }))
    expect(screen.getByRole('menuitemradio', { name: '시스템 설정' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('menuitemradio', { name: '다크' }))
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
    expect(localStorage.getItem('mes-theme')).toBe('dark')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/users/me', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ theme: 'dark' }) }))
    server = { ...server, theme: 'dark' }
    finish(jsonResponse(200, { name: me.name, theme: 'dark', locale: 'ko' }))
    await userEvent.click(screen.getByRole('button', { name: /김운영/ }))
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'English' })).not.toHaveAttribute('aria-disabled', 'true'))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'English' }))
    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
    expect(localStorage.getItem('mes-locale')).toBe('en')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/users/me', expect.objectContaining({ body: JSON.stringify({ locale: 'en' }) }))
    server = { ...server, locale: 'en' }
    finish(jsonResponse(200, { name: me.name, theme: 'dark', locale: 'en' }))
    await userEvent.click(screen.getByRole('button', { name: /김운영/ }))
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'English' })).not.toHaveAttribute('aria-disabled', 'true'))
    await userEvent.click(screen.getByRole('menuitemradio', { name: '라이트' }))
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'))
    server = { ...server, theme: 'light' }
    finish(jsonResponse(200, { name: me.name, theme: 'light', locale: 'en' }))
  })
  it('저장 실패 시 테마·언어와 캐시를 되돌리고 토스트로 알린다', async () => {
    const { toast } = await import('sonner')
    const errorToast = vi.spyOn(toast, 'error')
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/me' ? Promise.resolve(jsonResponse(200, { ...me, roles: ['member'] })) : new Promise<Response>((resolve) => { finish = resolve })))
    renderWithProviders(<AuthGate><TooltipProvider><TopBar /></TooltipProvider></AuthGate>)
    await screen.findByRole('button', { name: /김운영/ })
    for (const [label, key, value] of [['다크', 'mes-theme', 'system'], ['English', 'mes-locale', 'ko']]) {
      await userEvent.click(screen.getByRole('button', { name: /김운영/ }))
      await userEvent.click(screen.getByRole('menuitemradio', { name: label }))
      finish(jsonResponse(500, { message: '프로필 저장 실패' }))
      await waitFor(() => expect(localStorage.getItem(key!)).toBe(value))
      expect(document.documentElement).not.toHaveClass('dark')
      expect(document.documentElement.lang).toBe('ko')
    }
    expect(errorToast).toHaveBeenCalledWith('프로필 저장 실패')
    errorToast.mockRestore()
  })

  it('일반 사용자에게는 상태를 조회하지 않는다', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<MeContext value={{ ...me, roles: ['member'] }}><TooltipProvider><TopBar /></TooltipProvider></MeContext>)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Mock')).not.toBeInTheDocument()
  })
})
