import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { I18nProvider } from '@/i18n'
import { SettingsPage } from './SettingsPage'

vi.mock('@/app/NotificationBell', () => ({ NotificationBell: () => null }))
const assistants = [
  { id: 'a', name: '접수 도우미', status: 'open' }, { id: 'old', name: '폐기 도우미', status: 'retired' },
]
vi.mock('@/app/hooks', () => ({ useAssistants: () => assistants }))
afterEach(() => vi.unstubAllGlobals())
const me = { id: 'owner', name: '운영자', role: '', email: null, emailIsDefault: false, roles: ['system_owner'], theme: 'system', locale: 'ko' } as const
function renderPage(locale: 'ko' | 'en' = 'ko') { return renderWithProviders(<MeContext value={{ ...me, locale, roles: [...me.roles] }}><I18nProvider locale={locale}><TooltipProvider><SettingsPage /></TooltipProvider></I18nProvider></MeContext>) }

it('라디오 카드·접수 에이전트 키보드 선택과 지정 해제는 바꾸는 즉시 그 값만 저장한다', async () => {
  const saved: unknown[] = []
  const initial = { defaultModel: 'env-model', fileDelivery: 'inline', srIntakeAssistantId: null }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/settings') {
      if (init?.method === 'PATCH') { const body = JSON.parse(String(init.body)); saved.push(body); Object.assign(initial, body) }
      return jsonResponse(200, initial)
    }
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup()
  renderPage()
  const inline = await screen.findByRole('radio', { name: '텍스트로 붙이기' })
  expect(screen.queryByRole('button', { name: /저장/ })).not.toBeInTheDocument()
  inline.focus()
  await user.keyboard('{ArrowRight>}')
  await waitFor(() => expect(screen.getByRole('radio', { name: 'OpenWebUI 파일 첨부' })).toBeChecked())
  await user.keyboard('{/ArrowRight}')
  await waitFor(() => expect(saved).toEqual([{ fileDelivery: 'openwebui' }]))
  const picker = screen.getByRole('combobox', { name: 'SR 접수 에이전트' })
  await user.click(picker)
  expect(screen.queryByRole('option', { name: '폐기 도우미' })).not.toBeInTheDocument()
  await screen.findByRole('option', { name: '접수 도우미' })
  await user.keyboard('{ArrowDown}{Enter}')
  await waitFor(() => expect(saved[1]).toEqual({ srIntakeAssistantId: 'a' }))
  await screen.findByRole('button', { name: '접수 도우미 제거' })
  await user.click(screen.getByRole('button', { name: '지정 안 함' }))
  await waitFor(() => expect(saved[2]).toEqual({ srIntakeAssistantId: null }))
  expect(saved).toHaveLength(3)
  for (const body of saved) expect(body).not.toHaveProperty('defaultModel') // 쓰기 DTO는 defaultModel 제외 (S7 C2)
})

it('모델 목록에서 선택·설정 해제하면 override만 즉시 저장하고 적용 모델·출처·저장됨을 갱신한다', async () => {
  const saved: Record<string, unknown>[] = []
  let current = { defaultModel: 'env-model', defaultModelSource: 'env', defaultModelOverride: null as string | null }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/llm/models') return jsonResponse(200, { models: ['setting-a', 'setting-b'] })
    if (url === '/api/settings') {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)); saved.push(body)
        current = { defaultModelOverride: body.defaultModelOverride, defaultModel: body.defaultModelOverride ?? 'env-model', defaultModelSource: body.defaultModelOverride ? 'setting' : 'env' }
      }
      return jsonResponse(200, current)
    }
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup()
  renderPage()
  const select = await screen.findByRole('combobox', { name: '기본 모델' })
  await waitFor(() => expect(select).toBeEnabled())
  await user.click(select)
  await user.click(await screen.findByRole('option', { name: 'setting-b' }))
  await screen.findByText('현재 적용 모델: setting-b')
  expect(screen.getByText('출처: 전역 설정')).toBeInTheDocument()
  expect(saved).toEqual([{ defaultModelOverride: 'setting-b' }])
  expect(select).toHaveAccessibleDescription('저장됨')
  await user.click(screen.getByRole('button', { name: '설정 해제(.env 값 사용)' }))
  await screen.findByText('현재 적용 모델: env-model')
  expect(screen.getByText('출처: 환경 설정 (.env)')).toBeInTheDocument()
  expect(saved[1]).toEqual({ defaultModelOverride: null })
  await user.click(screen.getByRole('button', { name: '설정 해제(.env 값 사용)' }))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(saved).toHaveLength(2)
})

it('첨부 개수는 blur 때 그 필드만 저장해 다른 세션의 모델 변경을 유지하고 재조회로 표시를 갱신한다', async () => {
  const saved: Record<string, unknown>[] = []
  let current = { defaultModel: 'setting-a', defaultModelOverride: 'setting-a', defaultModelSource: 'setting', fileMaxPerRequest: 10 }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/llm/models') return jsonResponse(200, { models: ['setting-a', 'setting-b'] })
    if (url === '/api/settings') {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)); saved.push(body)
        current = { ...current, ...body, defaultModel: body.defaultModelOverride ?? current.defaultModelOverride }
      }
      return jsonResponse(200, current)
    }
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('현재 적용 모델: setting-a')
  current = { ...current, defaultModel: 'setting-b', defaultModelOverride: 'setting-b' }
  const fileLimit = screen.getByRole('spinbutton', { name: '첨부 개수 한도' })
  await user.clear(fileLimit)
  await user.type(fileLimit, '7')
  expect(saved).toEqual([])
  await user.tab()
  await waitFor(() => expect(saved).toEqual([{ fileMaxPerRequest: 7 }]))
  expect(fileLimit).toHaveAccessibleDescription('저장됨')
  await screen.findByText('현재 적용 모델: setting-b')
  expect(current.defaultModelOverride).toBe('setting-b')
  expect(fileLimit).toHaveValue(7)
})

it('저장 실패는 필드 근처에 오류로 보이고 다시 고르면 다시 보낸다', async () => {
  const saved: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/llm/models') return jsonResponse(200, { models: ['setting-a', 'setting-b'] })
    if (url === '/api/settings') {
      if (init?.method === 'PATCH') {
        saved.push(JSON.parse(String(init.body)))
        if (saved.length === 1) return jsonResponse(503, { message: '저장소 오류' })
      }
      return jsonResponse(200, { defaultModel: 'setting-a', defaultModelOverride: 'setting-a', defaultModelSource: 'setting' })
    }
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup()
  renderPage()
  const select = await screen.findByRole('combobox', { name: '기본 모델' })
  await waitFor(() => expect(select).toBeEnabled())
  await user.click(select)
  await user.click(await screen.findByRole('option', { name: 'setting-b' }))
  await waitFor(() => expect(saved).toHaveLength(1))
  await waitFor(() => expect(select).toHaveAccessibleDescription('저장소 오류'))
  expect(select).toHaveAttribute('aria-invalid', 'true')
  expect(select).toHaveValue('setting-b')
  await user.click(screen.getByRole('button', { name: '모델 목록 열기' }))
  await user.click(await screen.findByRole('option', { name: 'setting-b' }))
  await waitFor(() => expect(saved).toHaveLength(2))
  expect(saved).toEqual([{ defaultModelOverride: 'setting-b' }, { defaultModelOverride: 'setting-b' }])
  await waitFor(() => expect(select).toHaveAccessibleDescription('저장됨'))
})

it('모델 목록 실패는 오류를 표시하고 기존 override를 유지한 채 다른 설정만 저장한다', async () => {
  const saved: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/llm/models') return jsonResponse(503, {})
    if (init?.method === 'PATCH') saved.push(JSON.parse(String(init.body)))
    return jsonResponse(200, url === '/api/settings' ? { defaultModel: 'existing', defaultModelOverride: 'existing', defaultModelSource: 'setting', fileMaxPerRequest: 10 } : [])
  }))
  const user = userEvent.setup()
  renderPage()
  expect(await screen.findByText('모델 목록을 불러오지 못했습니다.')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '기본 모델' })).toHaveValue('existing')
  expect(screen.getByText('현재 적용 모델: existing')).toBeInTheDocument()
  const fileLimit = screen.getByRole('spinbutton', { name: '첨부 개수 한도' })
  await user.clear(fileLimit)
  await user.type(fileLimit, '5')
  await user.tab()
  await waitFor(() => expect(saved).toEqual([{ fileMaxPerRequest: 5 }]))
})

it('AI 연결 요약 카드는 /api/llm/status를 보여 주고 연결 진단으로 이어진다 — 사용자 목록은 여기서 조회하지 않는다', async () => {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    if (url === '/api/llm/status') return jsonResponse(200, { mode: 'live', preset: 'openwebui', baseUrlHost: 'llm.example.com', ok: false, detail: 'HTTP 503' })
    return jsonResponse(200, url === '/api/settings' ? { defaultModel: 'model' } : [])
  }))
  renderPage()
  const summary = await screen.findByRole('region', { name: 'AI 연결 요약' })
  expect(await within(summary).findByText('Live')).toBeInTheDocument()
  expect(within(summary).getByText('openwebui')).toBeInTheDocument()
  expect(within(summary).getByText('llm.example.com')).toBeInTheDocument()
  expect(within(summary).getByText('실패 (HTTP 503)')).toBeInTheDocument()
  expect(within(summary).getByRole('link', { name: '연결 진단 열기' })).toHaveAttribute('href', '/admin/diagnostics')
  await screen.findByRole('combobox', { name: '기본 모델' })
  expect(screen.queryByRole('heading', { name: '사용자·역할' })).not.toBeInTheDocument()
  expect(urls).not.toContain('/api/users')
})

it('영문 화면은 도메인 기본값의 출처와 설정 해제를 표시한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => jsonResponse(200, url === '/api/settings'
    ? { defaultModel: 'glm-5.2', defaultModelSource: 'default' } : url === '/api/llm/models' ? { models: [] } : [])))
  renderPage('en')
  expect(await screen.findByText('Current model: glm-5.2')).toBeInTheDocument()
  expect(screen.getByText('Source: Domain default')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Clear override (use .env)' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'OpenWebUI address' })).toBeInTheDocument()
})

it('OpenWebUI 도구 전달은 라디오를 바꾸는 즉시 그 값만 PATCH하고 저장됨을 구획 안에 보인다', async () => {
  const saved: Record<string, unknown>[] = []
  let current = { defaultModel: 'env-model', owuiTools: 'auto', fileMaxPerRequest: 10 }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/settings') {
      if (init?.method === 'PATCH') { const body = JSON.parse(String(init.body)); saved.push(body); current = { ...current, ...body } }
      return jsonResponse(200, current)
    }
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup()
  renderPage()
  expect(await screen.findByRole('radio', { name: '자동 (기본)' })).toBeChecked()
  const toolsSection = screen.getByRole('region', { name: 'OpenWebUI 도구 전달' })
  expect(within(toolsSection).getByRole('heading', { level: 2, name: 'OpenWebUI 도구 전달' })).toBeInTheDocument()
  expect(within(toolsSection).queryByRole('button')).not.toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: '끔' }))
  await waitFor(() => expect(saved).toEqual([{ owuiTools: 'off' }]))
  expect(await within(toolsSection).findByRole('status')).toHaveTextContent('저장됨')
  expect(screen.getByRole('radio', { name: '끔' })).toBeChecked()
  await user.click(screen.getByRole('radio', { name: '끔' }))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(saved).toHaveLength(1)
})

it('AI 도우미 캐릭터는 별도 multipart로 올리고 제거는 DELETE — 일반 설정 PATCH에는 섞이지 않는다 (U4)', async () => {
  const calls: Array<{ url: string; method?: string; body?: BodyInit | null }> = []
  let current: Record<string, unknown> = { defaultModel: 'env-model', fileMaxPerRequest: 10, fileDelivery: 'inline', assistantImageFileId: null }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/settings/assistant-image') {
      calls.push({ url, method: init?.method, body: init?.body })
      current = { ...current, assistantImageFileId: init?.method === 'POST' ? 'img-1' : null }
      return init?.method === 'POST' ? jsonResponse(201, current) : jsonResponse(204)
    }
    if (url === '/api/settings') {
      if (init?.method === 'PATCH') { calls.push({ url, method: 'PATCH', body: init.body }); current = { ...current, ...JSON.parse(String(init.body)) } }
      return jsonResponse(200, current)
    }
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup()
  renderPage()
  const section = await screen.findByRole('region', { name: 'AI 도우미 캐릭터' })
  expect(within(section).queryByRole('img')).not.toBeInTheDocument()
  expect(within(section).queryByRole('button', { name: '캐릭터 제거' })).not.toBeInTheDocument()
  await user.upload(within(section).getByLabelText('이미지 선택'), new File(['png'], 'character.png', { type: 'image/png' }))
  await within(section).findByRole('img', { name: 'AI 도우미 캐릭터' })
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({ url: '/api/settings/assistant-image', method: 'POST' })
  expect(calls[0]!.body).toBeInstanceOf(FormData)
  expect((calls[0]!.body as FormData).get('file')).toBeInstanceOf(File)
  expect(within(section).getByRole('img')).toHaveAttribute('src', '/api/settings/assistant-image?v=img-1')
  await user.click(within(section).getByRole('button', { name: '캐릭터 제거' }))
  await waitFor(() => expect(within(section).queryByRole('img')).not.toBeInTheDocument())
  expect(calls[1]).toMatchObject({ url: '/api/settings/assistant-image', method: 'DELETE' })
  await user.click(screen.getByRole('radio', { name: 'OpenWebUI 파일 첨부' }))
  await waitFor(() => expect(calls).toHaveLength(3))
  expect(JSON.parse(String(calls[2]!.body))).toEqual({ fileDelivery: 'openwebui' })
})

it('입력 중인 값은 다른 필드 저장·재조회에도 유지되고 blur 때 따로 저장한다', async () => {
  const saved: Record<string, unknown>[] = []
  let current = { defaultModel: 'env-model', owuiTools: 'auto', requestBudgetBytes: 1000000, fileMaxPerRequest: 10 }
  let reads = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/settings') {
      if (init?.method === 'PATCH') { const body = JSON.parse(String(init.body)); saved.push(body); current = { ...current, ...body } }
      else reads += 1
      return jsonResponse(200, current)
    }
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup()
  renderPage()
  const budget = await screen.findByRole('spinbutton', { name: '요청 크기 한도 (바이트)' })
  await user.clear(budget)
  await user.type(budget, '2000000')
  await user.click(screen.getByRole('radio', { name: '끔' }))
  await waitFor(() => expect(saved).toEqual([{ requestBudgetBytes: 2000000 }, { owuiTools: 'off' }]))
  await waitFor(() => expect(reads).toBe(3))
  expect(screen.getByRole('spinbutton', { name: '요청 크기 한도 (바이트)' })).toHaveValue(2000000)
  expect(screen.getByRole('spinbutton', { name: '첨부 개수 한도' })).toHaveValue(10)
  expect(screen.getByRole('radio', { name: '끔' })).toBeChecked()
})

it('OpenWebUI 주소는 blur 때 저장하고 {modelId} 안내를 보인다', async () => {
  const saved: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/settings') {
      if (init?.method === 'PATCH') saved.push(JSON.parse(String(init.body)))
      return jsonResponse(200, { defaultModel: 'env-model', link1Rule: '' })
    }
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup()
  renderPage()
  const address = await screen.findByRole('textbox', { name: 'OpenWebUI 주소' })
  expect(address).toHaveAccessibleDescription(/\{modelId\}/)
  await user.type(address, 'https://owui.example/')
  expect(saved).toEqual([])
  await user.tab()
  await waitFor(() => expect(saved).toEqual([{ link1Rule: 'https://owui.example/' }]))
  expect(address).toHaveAccessibleDescription(/저장됨/)
})

it('URL 자동 읽기와 허용·차단 목록은 각 설정 키만 저장한다', async () => {
  const saved: unknown[] = []
  const initial = { urlAutoFetch: true, urlAllowDomains: [], urlBlockDomains: [] }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/settings') {
      if (init?.method === 'PATCH') { const body = JSON.parse(String(init.body)); saved.push(body); Object.assign(initial, body) }
      return jsonResponse(200, initial)
    }
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup(); renderPage()
  await user.click(await screen.findByRole('checkbox', { name: '질문에 있는 웹 페이지를 자동으로 읽기' }))
  await waitFor(() => expect(saved).toContainEqual({ urlAutoFetch: false }))
  await user.type(screen.getByLabelText('허용 도메인'), 'Intra.Example, docs.example')
  await user.tab()
  await waitFor(() => expect(saved).toContainEqual({ urlAllowDomains: ['intra.example', 'docs.example'] }))
  await user.type(screen.getByLabelText('차단 도메인'), 'bad.intra.example')
  await user.tab()
  await waitFor(() => expect(saved).toContainEqual({ urlBlockDomains: ['bad.intra.example'] }))
})
