import { useQueryClient } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthGate } from '@/app/AuthGate'
import type { Me } from '@mes/contracts'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { MyInfoPage } from './MyInfoPage'
import { useUiStore } from '@/app/uiStore'
import { takeTutorialReplay, tutorialKey } from '@/features/assistant-pill/tutorial'

vi.mock('@/app/NotificationBell', () => ({ NotificationBell: () => null }))
const me = { id: 'u1', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'] as const, theme: 'system' as const, locale: 'ko' as const }
function RefreshMe() {
  const client = useQueryClient()
  return <button onClick={() => void client.refetchQueries({ queryKey: ['me'] })}>프로필 새로고침</button>
}

describe('내 정보 프로필 세그먼트', () => {
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })
  it('튜토리얼 재실행은 도우미를 열고 프로필 저장 API를 호출하지 않는다', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, me))
    vi.stubGlobal('fetch', fetchMock)
    useUiStore.setState({ assistantOpen: false })
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /></TooltipProvider></AuthGate>)
    await userEvent.click(await screen.findByRole('button', { name: '튜토리얼 다시 보기' }))
    expect(useUiStore.getState().assistantOpen).toBe(true)
    expect(localStorage.getItem(tutorialKey(me.id))).toBe('accepted')
    expect(takeTutorialReplay(me.id)).toBe(true)
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
    expect(screen.queryByRole('button', { name: '저장' })).not.toBeInTheDocument()
    act(() => useUiStore.setState({ assistantOpen: false }))
  })
  it.each(['u1@example-.com', `u1@${'a'.repeat(64)}.com`, `u1@${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.com`])('기본 이메일 %s를 그대로 두면 이름 blur 저장을 막지 않고 이메일은 전송하지 않는다', async (defaultEmail) => {
    let server = { ...me, email: defaultEmail, emailIsDefault: true }
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') server = { ...server, ...JSON.parse(init.body as string) }
      return jsonResponse(200, server)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /></TooltipProvider></AuthGate>)
    const email = await screen.findByLabelText('이메일')
    expect(email).toHaveValue(defaultEmail)
    await userEvent.clear(screen.getByLabelText('이름'))
    await userEvent.type(screen.getByLabelText('이름'), '새 이름')
    expect(fetchMock).not.toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'PATCH' }))
    await userEvent.tab()
    await waitFor(() => expect(server.name).toBe('새 이름'))
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ body: JSON.stringify({ name: '새 이름' }) }))
    expect(screen.getByLabelText('이름')).toHaveAccessibleDescription('저장됨')
    await userEvent.click(email)
    await userEvent.tab()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
    expect(server).toMatchObject({ email: defaultEmail, emailIsDefault: true })
  })
  it('기본 이메일을 수정하면 형식 검증 오류를 필드 근처에 보이고 되돌리면 전송하지 않는다', async () => {
    const server = { ...me, email: 'u1@example-.com', emailIsDefault: true }
    const fetchMock = vi.fn(async () => jsonResponse(200, server))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /></TooltipProvider></AuthGate>)
    const email = await screen.findByLabelText('이메일')
    await userEvent.clear(email)
    await userEvent.type(email, 'invalid')
    expect(email).toHaveAttribute('type', 'email')
    await userEvent.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent('이메일 형식이 올바르지 않습니다')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(fetchMock).not.toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'PATCH' }))
    await userEvent.clear(email)
    await userEvent.type(email, server.email)
    await userEvent.tab()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'PATCH' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it.each(['ko', 'en'] as const)('이메일 표시·blur 저장·해제와 기본값 구분 (%s)', async locale => {
    let server = { ...me, roles: [...me.roles], locale, email: 'u1@example.com', emailIsDefault: true }
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const input = JSON.parse(init.body as string)
        server = { ...server, ...input, ...(input.email !== undefined && { email: input.email || 'u1@example.com', emailIsDefault: !input.email }) }
      }
      return jsonResponse(200, server)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /></TooltipProvider></AuthGate>)
    const email = await screen.findByLabelText(locale === 'ko' ? '이메일' : 'Email')
    expect(email).toHaveValue('u1@example.com')
    expect(email).toHaveAttribute('maxlength', '191')
    await userEvent.click(email)
    await userEvent.tab()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'PATCH' }))
    await userEvent.clear(email)
    await userEvent.type(email, 'Mixed.Case@example.net')
    expect(email).toHaveAttribute('type', 'email')
    await userEvent.tab()
    await waitFor(() => expect(server.email).toBe('Mixed.Case@example.net'))
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ body: JSON.stringify({ email: 'Mixed.Case@example.net' }) }))
    expect(email).toHaveAccessibleDescription(locale === 'ko' ? /저장됨/ : /Saved/)
    await userEvent.clear(email)
    await userEvent.tab()
    await waitFor(() => expect(email).toHaveValue('u1@example.com'))
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ body: JSON.stringify({ email: null }) }))
    expect(server.emailIsDefault).toBe(true)
  })
  it('이메일 저장 실패 시 입력값은 유지하고 오류를 필드 근처에 보이며 다시 blur하면 재시도한다', async () => {
    const patches: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') { patches.push(String(init.body)); return jsonResponse(400, { message: 'invalid email' }) }
      return jsonResponse(200, { ...me, email: null, emailIsDefault: false })
    }))
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /></TooltipProvider></AuthGate>)
    const email = await screen.findByLabelText('이메일')
    await userEvent.type(email, 'a@example.com')
    await userEvent.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid email')
    expect(email).toHaveValue('a@example.com')
    await userEvent.click(email)
    await userEvent.tab()
    await waitFor(() => expect(patches).toHaveLength(2))
  })
  it('테마 저장 중 /me의 다른 필드 변경을 유지하고 실패 시 바꾼 필드만 되돌린다', async () => {
    let server: Me = { ...me, roles: [...me.roles] }
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => url === '/api/me' && init?.method !== 'PATCH' ? Promise.resolve(jsonResponse(200, server)) : new Promise<Response>((resolve) => { finish = resolve })))
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /><RefreshMe /></TooltipProvider></AuthGate>)
    await screen.findByLabelText('이름')
    await userEvent.click(screen.getByRole('radio', { name: '다크' }))
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
    server = { ...server, theme: 'light', locale: 'en' }
    await userEvent.click(screen.getByRole('button', { name: '프로필 새로고침' }))
    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
    expect(document.documentElement).toHaveClass('dark')
    finish(jsonResponse(500, { message: '프로필 저장 실패' }))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'English' })).toBeEnabled())
    expect(document.documentElement).not.toHaveClass('dark')
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('mes-locale')).toBe('en')
    expect(localStorage.getItem('mes-theme')).toBe('light')
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked()
  })
  it.each([
    { input: { theme: 'dark' as const }, label: '다크', theme: 'dark', locale: 'ko' },
    { input: { locale: 'en' as const }, label: 'English', theme: 'system', locale: 'en' },
  ])('저장 중 시작된 늦은 /me가 $label 저장값을 덮어쓰지 않고 저장 뒤 서버를 재조회한다', async ({ input, label, theme, locale }) => {
    let client!: ReturnType<typeof useQueryClient>
    function CaptureClient() { client = useQueryClient(); return null }
    let server: Me = { ...me, roles: [...me.roles] }
    let finishSave!: (response: Response) => void
    let finishStaleMe!: (response: Response) => void
    let reads = 0
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url !== '/api/me' || init?.method === 'PATCH') return new Promise<Response>((resolve) => { finishSave = resolve })
      reads++
      if (reads === 2) return new Promise<Response>((resolve) => { finishStaleMe = resolve })
      return Promise.resolve(jsonResponse(200, server))
    }))
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /><CaptureClient /></TooltipProvider></AuthGate>)
    await screen.findByLabelText('이름')
    await userEvent.click(screen.getByRole('radio', { name: label }))
    await waitFor(() => expect(screen.getByRole('radio', { name: label })).toBeChecked())
    let staleRead!: Promise<void>
    await act(async () => { staleRead = client.refetchQueries({ queryKey: ['me'] }) })
    const staleMe = jsonResponse(200, server)
    server = { ...server, ...input, name: '서버의 최신 이름' }
    await act(async () => { finishSave(jsonResponse(200, { name: me.name, theme: server.theme, locale: server.locale, email: null, emailIsDefault: false })) })
    await waitFor(() => expect(screen.getByRole('radio', { name: label })).toBeEnabled())
    await act(async () => { finishStaleMe(staleMe); await staleRead })
    expect(client.getQueryData<Me>(['me'])).toMatchObject({ theme, locale, name: '서버의 최신 이름' })
    await waitFor(() => expect(screen.getByRole('radio', { name: label })).toBeChecked())
    expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark')
    expect(document.documentElement.lang).toBe(locale)
    expect(localStorage.getItem('mes-theme')).toBe(theme)
    expect(localStorage.getItem('mes-locale')).toBe(locale)
    expect(screen.getByRole('button', { name: /서버의 최신 이름/ })).toBeInTheDocument()
  })
  it('늦은 테마 응답이 이미 저장된 새 이름을 덮어쓰지 않는다', async () => {
    let server: Me = { ...me, roles: [...me.roles] }
    let finishName!: (response: Response) => void
    let finishTheme!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/me' && init?.method !== 'PATCH') return Promise.resolve(jsonResponse(200, server))
      const input = JSON.parse(init!.body as string) as { name?: string }
      return new Promise<Response>((resolve) => { if (input.name) finishName = resolve; else finishTheme = resolve })
    }))
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /></TooltipProvider></AuthGate>)
    await screen.findByLabelText('이름')
    await userEvent.clear(screen.getByLabelText('이름'))
    await userEvent.type(screen.getByLabelText('이름'), '새 이름')
    await userEvent.click(screen.getByRole('radio', { name: '다크' }))
    server = { ...server, name: '새 이름' }
    finishName(jsonResponse(200, { name: '새 이름', theme: 'dark', locale: 'ko', email: null, emailIsDefault: false }))
    await screen.findByRole('button', { name: /새 이름/ })
    server = { ...server, theme: 'dark' }
    finishTheme(jsonResponse(200, { name: me.name, theme: 'dark', locale: 'ko', email: null, emailIsDefault: false }))
    await waitFor(() => expect(screen.getByRole('radio', { name: '다크' })).toBeEnabled())
    expect(screen.getByRole('button', { name: /새 이름/ })).toBeInTheDocument()
    expect(document.documentElement).toHaveClass('dark')
  })
  it('테마와 언어를 선택해 저장하고 이름도 계속 수정할 수 있다', async () => {
    let user: Me = { ...me, roles: [...me.roles] }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/me' && init?.method !== 'PATCH') return jsonResponse(200, user)
      user = { ...user, ...JSON.parse(init!.body as string) }
      return jsonResponse(200, { name: user.name, theme: user.theme, locale: user.locale, email: null, emailIsDefault: false })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /></TooltipProvider></AuthGate>)
    await screen.findByLabelText('이름')
    await userEvent.click(screen.getByRole('radio', { name: '다크' }))
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'English' })).toBeEnabled())
    await userEvent.click(screen.getByRole('radio', { name: 'English' }))
    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
    expect(fetchMock).toHaveBeenCalledWith('/api/users/me', expect.objectContaining({ body: JSON.stringify({ locale: 'en' }) }))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'English' })).toBeEnabled())
    await userEvent.clear(screen.getByLabelText('Name'))
    await userEvent.type(screen.getByLabelText('Name'), '새 이름')
    await userEvent.tab()
    await waitFor(() => expect(screen.getByRole('button', { name: /새 이름/ })).toBeInTheDocument())
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.lang).toBe('en')
  })
  it('빈 이름은 저장하지 않고 오류를 보인다', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, me))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /></TooltipProvider></AuthGate>)
    const name = await screen.findByLabelText('이름')
    await userEvent.clear(name)
    await userEvent.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent('이름을 입력하세요')
    expect(fetchMock).not.toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'PATCH' }))
  })
})
