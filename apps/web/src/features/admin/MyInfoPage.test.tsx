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
    act(() => useUiStore.setState({ assistantOpen: false }))
  })
  it.each(['u1@example-.com', `u1@${'a'.repeat(64)}.com`, `u1@${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.com`])('기본 이메일 %s를 그대로 두면 이름 저장을 막지 않고 이메일은 전송하지 않는다', async (defaultEmail) => {
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
    expect(email.closest('form')!.checkValidity()).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(server.name).toBe('새 이름'))
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ body: JSON.stringify({ name: '새 이름' }) }))
    expect(server).toMatchObject({ email: defaultEmail, emailIsDefault: true })
  })
  it('기본 이메일을 수정하면 이메일 형식 검증을 적용하고 되돌리면 이름만 저장한다', async () => {
    const server = { ...me, email: 'u1@example-.com', emailIsDefault: true }
    const fetchMock = vi.fn(async () => jsonResponse(200, server))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /></TooltipProvider></AuthGate>)
    const email = await screen.findByLabelText('이메일')
    await userEvent.clear(email)
    await userEvent.type(email, 'invalid')
    expect(email).toHaveAttribute('type', 'email')
    expect(email.closest('form')!.checkValidity()).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'PATCH' }))
    await userEvent.clear(email)
    await userEvent.type(email, server.email)
    expect(email.closest('form')!.checkValidity()).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ body: JSON.stringify({ name: me.name }) })))
  })
  it.each(['ko', 'en'] as const)('이메일 표시·저장·해제와 기본값 구분 (%s)', async locale => {
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
    await userEvent.click(screen.getByRole('button', { name: locale === 'ko' ? '저장' : 'Save' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ body: JSON.stringify({ name: me.name }) }))
    await userEvent.clear(email)
    await userEvent.type(email, 'Mixed.Case@example.net')
    expect(email).toHaveAttribute('type', 'email')
    await userEvent.click(screen.getByRole('button', { name: locale === 'ko' ? '저장' : 'Save' }))
    await waitFor(() => expect(server.email).toBe('Mixed.Case@example.net'))
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ body: JSON.stringify({ name: me.name, email: 'Mixed.Case@example.net' }) }))
    await userEvent.clear(email)
    await userEvent.click(screen.getByRole('button', { name: locale === 'ko' ? '저장' : 'Save' }))
    await waitFor(() => expect(email).toHaveValue('u1@example.com'))
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ body: JSON.stringify({ name: me.name, email: null }) }))
    expect(server.emailIsDefault).toBe(true)
  })
  it('이메일 저장 실패 시 입력값은 유지하고 저장 버튼을 다시 활성화한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => jsonResponse(init?.method === 'PATCH' ? 400 : 200, init?.method === 'PATCH' ? { message: 'invalid email' } : { ...me, email: null, emailIsDefault: false })))
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /></TooltipProvider></AuthGate>)
    const email = await screen.findByLabelText('이메일')
    await userEvent.type(email, 'a@example.com')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '저장' })).toBeEnabled())
    expect(email).toHaveValue('a@example.com')
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
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /새 이름/ })).toBeInTheDocument())
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.lang).toBe('en')
  })
})
