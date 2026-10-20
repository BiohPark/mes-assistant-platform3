import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { AuthGate } from './AuthGate'
import { MeContext } from './auth'
import { TopBar } from './TopBar'
import { resetPopout } from './popout'
import { useProfile } from './profile'
import { getDraft, setDraft } from '@/features/chat/drafts'
import { useMaterialsDrawer } from '@/features/task/materialsDrawer'

vi.mock('./NotificationBell', () => ({ NotificationBell: () => null }))

describe('TopBar 팝업 모드', () => {
  afterEach(() => { vi.unstubAllGlobals(); resetPopout(); window.history.replaceState({}, '', '/') })

  it('제목(과 actions)만 남기고 테마·언어·알림·사용자 메뉴는 숨긴다', () => {
    window.history.replaceState({}, '', '/c/t?popout=1')
    resetPopout()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<MeContext value={{ ...me, roles: [...me.roles] }}><TooltipProvider><TopBar title="팝업 제목" actions={<button type="button">도구</button>} /></TooltipProvider></MeContext>)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('팝업 제목')
    expect(screen.getByRole('button', { name: '도구' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /모드로 전환$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'English로 전환' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /김운영/ })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled() // LLM 상태 배지도 없다
  })
})

const me = { theme: 'system' as const, locale: 'ko' as const, id: 'u1', name: '김운영', role: '', email: null, emailIsDefault: false, roles: ['member', 'system_owner'] as const }

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
    setDraft('t', { text: '보내지 않은 초안', pending: [], discussion: false })
    useMaterialsDrawer.getState().update('t', { noteDraft: '레일 메모 초안' })
    await userEvent.click(screen.getByRole('menuitem', { name: '로그아웃' }))
    await waitFor(() => expect(afterLogout).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }))
    expect(getDraft('t')).toBeUndefined() // 로그아웃하면 전환 초안을 폐기한다
    expect(useMaterialsDrawer.getState().byTask.t).toBeUndefined() // 레일 초안(메모리·세션)도
    expect(Object.keys(sessionStorage).some(key => key.startsWith('mes-hub:panel-state:'))).toBe(false)
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
    await userEvent.click(screen.getByRole('menuitem', { name: 'Log out' }))
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
    finish(jsonResponse(200, { name: me.name, theme: 'dark', locale: 'ko', email: null, emailIsDefault: false }))
    await userEvent.click(screen.getByRole('button', { name: /김운영/ }))
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'English' })).not.toHaveAttribute('aria-disabled', 'true'))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'English' }))
    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
    expect(localStorage.getItem('mes-locale')).toBe('en')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/users/me', expect.objectContaining({ body: JSON.stringify({ locale: 'en' }) }))
    server = { ...server, locale: 'en' }
    finish(jsonResponse(200, { name: me.name, theme: 'dark', locale: 'en', email: null, emailIsDefault: false }))
    await userEvent.click(screen.getByRole('button', { name: /김운영/ }))
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'English' })).not.toHaveAttribute('aria-disabled', 'true'))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Light' }))
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'))
    server = { ...server, theme: 'light' }
    finish(jsonResponse(200, { name: me.name, theme: 'light', locale: 'en', email: null, emailIsDefault: false }))
  })
  it('상단 아이콘으로 다크모드·언어를 바로 바꾸고 내 정보와 같은 경로로 저장한다 — 요청자도 쓴다', async () => {
    let finish!: (response: Response) => void
    const fetchMock = vi.fn((url: string) => url === '/api/me' ? Promise.resolve(jsonResponse(200, { ...me, roles: ['requester'] })) : new Promise<Response>((resolve) => { finish = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AuthGate><TooltipProvider><TopBar /><ProfileState /></TooltipProvider></AuthGate>)
    await userEvent.click(await screen.findByRole('button', { name: '다크 모드로 전환' }))
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
    expect(localStorage.getItem('mes-theme')).toBe('dark')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/users/me', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ theme: 'dark' }) }))
    expect(screen.getByRole('button', { name: '라이트 모드로 전환' })).toBeDisabled() // 저장 중에는 잠근다
    finish(jsonResponse(200, { name: me.name, theme: 'dark', locale: 'ko', email: null, emailIsDefault: false }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'English로 전환' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'English로 전환' }))
    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
    expect(localStorage.getItem('mes-locale')).toBe('en')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/users/me', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ locale: 'en' }) }))
    finish(jsonResponse(200, { name: me.name, theme: 'dark', locale: 'en', email: null, emailIsDefault: false }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }))
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'))
    expect(screen.getByLabelText('프로필 상태')).toHaveTextContent('light·en')
    finish(jsonResponse(200, { name: me.name, theme: 'light', locale: 'en', email: null, emailIsDefault: false }))
    expect(await screen.findByRole('button', { name: 'Switch to 한국어' })).toBeInTheDocument()
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

  it('SO의 Mock/Live 배지는 연결 진단으로 가는 링크다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/llm/status' ? jsonResponse(200, { mode: 'live', preset: 'openai-compatible', baseUrlHost: 'llm.example.com', ok: true, detail: '' }) : jsonResponse(204)))
    renderWithProviders(<MeContext value={{ ...me, roles: [...me.roles] }}><TooltipProvider><TopBar /></TooltipProvider></MeContext>)
    const badge = await screen.findByRole('link', { name: 'Live · 연결 진단 열기' }) // 접근성 이름에 보이는 글자가 들어간다(WCAG 2.5.3)
    expect(badge).toHaveTextContent('Live')
    expect(badge).toHaveAttribute('href', '/admin/diagnostics')
  })
})
