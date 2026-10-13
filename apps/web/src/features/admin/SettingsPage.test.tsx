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

it('라디오 카드·접수 에이전트 키보드 선택과 지정 해제를 설정에 저장한다', async () => {
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
  inline.focus()
  await user.keyboard('{ArrowRight>}')
  await waitFor(() => expect(screen.getByRole('radio', { name: 'OpenWebUI 파일 첨부' })).toBeChecked())
  await user.keyboard('{/ArrowRight}')
  const picker = screen.getByRole('combobox', { name: 'SR 접수 에이전트' })
  await user.click(picker)
  expect(screen.queryByRole('option', { name: '폐기 도우미' })).not.toBeInTheDocument()
  await screen.findByRole('option', { name: '접수 도우미' })
  await user.keyboard('{ArrowDown}{Enter}')
  await user.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(saved).toHaveLength(1))
  expect(saved[0]).toMatchObject({ fileDelivery: 'openwebui', srIntakeAssistantId: 'a' })
  await screen.findByRole('button', { name: '접수 도우미 제거' })
  await user.click(screen.getByRole('button', { name: '지정 안 함' }))
  await user.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(saved).toHaveLength(2))
  expect(saved[1]).toMatchObject({ srIntakeAssistantId: null })
  for (const body of saved) expect(body).not.toHaveProperty('defaultModel') // 쓰기 DTO는 defaultModel 제외 (S7 C2)
})

it('모델 목록에서 선택·설정 해제하고 적용 모델과 출처를 갱신한다', async () => {
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
  await user.click(screen.getByRole('button', { name: '설정 저장' }))
  await screen.findByText('현재 적용 모델: setting-b')
  expect(screen.getByText('출처: 전역 설정')).toBeInTheDocument()
  expect(saved[0]).toMatchObject({ defaultModelOverride: 'setting-b' })
  expect(saved[0]).not.toHaveProperty('defaultModelSource')
  expect(saved[0]).not.toHaveProperty('defaultModel')
  await user.click(screen.getByRole('button', { name: '설정 해제(.env 값 사용)' }))
  await user.click(screen.getByRole('button', { name: '설정 저장' }))
  await screen.findByText('현재 적용 모델: env-model')
  expect(screen.getByText('출처: 환경 설정 (.env)')).toBeInTheDocument()
  expect(saved[1]).toMatchObject({ defaultModelOverride: null })
})

it('첨부 개수만 저장하면 모델 override를 전송하지 않아 다른 세션의 변경을 유지한다', async () => {
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
  await user.clear(screen.getByRole('spinbutton', { name: '첨부 개수 한도' }))
  await user.type(screen.getByRole('spinbutton', { name: '첨부 개수 한도' }), '7')
  await user.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(saved).toHaveLength(1))
  expect(saved[0]).toMatchObject({ fileMaxPerRequest: 7 })
  expect(saved[0]).not.toHaveProperty('defaultModelOverride')
  await screen.findByText('현재 적용 모델: setting-b')
  expect(current.defaultModelOverride).toBe('setting-b')
})

it('저장 성공 후 재조회가 실패해도 모델 기준값을 갱신해 다음 저장에서 생략한다', async () => {
  const saved: Record<string, unknown>[] = []
  let reads = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/llm/models') return jsonResponse(200, { models: ['setting-b'] })
    if (url === '/api/settings') {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)); saved.push(body)
        return jsonResponse(200, { defaultModel: 'setting-b', defaultModelOverride: 'setting-b', defaultModelSource: 'setting' })
      }
      reads += 1
      return reads === 1 ? jsonResponse(200, { defaultModel: 'env-model', defaultModelOverride: null }) : jsonResponse(503, {})
    }
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup()
  renderPage()
  const select = await screen.findByRole('combobox', { name: '기본 모델' })
  await waitFor(() => expect(select).toBeEnabled())
  await user.click(select)
  await user.click(await screen.findByRole('option', { name: 'setting-b' }))
  await user.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(reads).toBe(2))
  expect(saved[0]).toMatchObject({ defaultModelOverride: 'setting-b' })
  await user.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(saved).toHaveLength(2))
  expect(saved[1]).not.toHaveProperty('defaultModelOverride')
})

it('모델 목록 실패는 오류를 표시하고 기존 override를 유지한 채 다른 설정을 저장한다', async () => {
  const saved: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/llm/models') return jsonResponse(503, {})
    if (init?.method === 'PATCH') saved.push(JSON.parse(String(init.body)))
    return jsonResponse(200, url === '/api/settings' ? { defaultModel: 'existing', defaultModelOverride: 'existing', defaultModelSource: 'setting' } : [])
  }))
  const user = userEvent.setup()
  renderPage()
  expect(await screen.findByText('모델 목록을 불러오지 못했습니다.')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '기본 모델' })).toHaveValue('existing')
  expect(screen.getByText('현재 적용 모델: existing')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(saved).toHaveLength(1))
  expect(saved[0]).not.toHaveProperty('defaultModelOverride')
})

it.each(['setting-b', null])('모델 변경(%s) 저장 실패 후 재시도에도 override를 포함한다', async model => {
  const saved: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/llm/models') return jsonResponse(200, { models: ['setting-a', 'setting-b'] })
    if (url === '/api/settings') {
      if (init?.method === 'PATCH') {
        saved.push(JSON.parse(String(init.body)))
        if (saved.length === 1) return jsonResponse(503, {})
      }
      return jsonResponse(200, { defaultModel: 'setting-a', defaultModelOverride: 'setting-a', defaultModelSource: 'setting' })
    }
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup()
  renderPage()
  const select = await screen.findByRole('combobox', { name: '기본 모델' })
  await waitFor(() => expect(select).toBeEnabled())
  if (model === null) await user.click(screen.getByRole('button', { name: '설정 해제(.env 값 사용)' }))
  else {
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: model }))
  }
  await user.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(saved).toHaveLength(1))
  await user.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(saved).toHaveLength(2))
  expect(saved).toEqual([{ defaultModelOverride: model }, { defaultModelOverride: model }])
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
  await screen.findByRole('button', { name: '설정 저장' })
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
})

it('OpenWebUI 도구 전달은 별도로 저장하고 변경한 경우에만 전송한다', async () => {
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
  expect(screen.getAllByRole('button', { name: /설정 저장/ })).toHaveLength(1)
  const toolsForm = screen.getByRole('form', { name: 'OpenWebUI 도구 전달' })
  expect(within(toolsForm).getByRole('heading', { level: 2, name: 'OpenWebUI 도구 전달' })).toBeInTheDocument()
  expect(within(toolsForm).getByRole('button', { name: '도구 전달 저장' })).toBeDisabled()
  await user.click(screen.getByRole('radio', { name: '끔' }))
  await user.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(saved).toHaveLength(1))
  expect(saved[0]).not.toHaveProperty('owuiTools')
  await user.click(screen.getByRole('radio', { name: '끔' }))
  await user.click(screen.getByRole('button', { name: '도구 전달 저장' }))
  await waitFor(() => expect(saved).toHaveLength(2))
  expect(saved[1]).toEqual({ owuiTools: 'off' })
  await waitFor(() => expect(screen.getByRole('button', { name: '도구 전달 저장' })).toBeDisabled())
})
