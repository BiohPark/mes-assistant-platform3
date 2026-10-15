import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { MeContext } from '@/app/auth'
import { renderWithProviders, jsonResponse } from '@/test/render'
import { ModelPicker } from './ModelPicker'

const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' } satisfies Task
const assistant = { id: 'a', name: '도우미', modelId: 'default-model' } as Assistant
afterEach(() => vi.unstubAllGlobals())

it('writes a selected model to the task and leaves the thread untouched', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/llm/models') return jsonResponse(200, { models: ['chosen-model'] })
    return jsonResponse(200, {})
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><ModelPicker task={task} assistant={assistant} /></MeContext>)
  fireEvent.click(screen.getByTitle('이 대화의 모델 변경'))
  fireEvent.click(await screen.findByRole('button', { name: 'chosen-model' }))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t' && init?.method === 'PATCH' && JSON.parse(String(init.body)).modelId === 'chosen-model')).toBe(true))
  expect(calls.some(([url]) => url.includes('/threads/'))).toBe(false)
})

it('shows the server default model when neither task nor assistant selects one', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/settings') return jsonResponse(200, { defaultModel: 'server-default' })
    if (url === '/api/llm/models') return jsonResponse(200, { models: ['server-default'] })
    return jsonResponse(404)
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><ModelPicker task={task} assistant={{ ...assistant, modelId: undefined }} /></MeContext>)
  await waitFor(() => expect(screen.getByTitle('이 대화의 모델 변경')).toHaveTextContent('server-default'))
  expect(screen.getByTitle('이 대화의 모델 변경')).toHaveTextContent('공통 기본 모델')
})

it('constrains long model names and opens a viewport-bound mobile popup with themed warnings', async () => {
  const modelId = 'missing-model-with-a-very-long-provider-and-version-name'
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/llm/models'
    ? jsonResponse(200, { models: ['available-model'] }) : jsonResponse(200, {})))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><ModelPicker task={{ ...task, modelId }} assistant={assistant} /></MeContext>)
  const trigger = screen.getByTitle('이 대화의 모델 변경')
  await waitFor(() => expect(trigger).toHaveClass('text-tone-warning-fg'))
  expect(trigger).toHaveClass('max-w-[60vw]', 'truncate', 'border-tone-warning-fg')
  expect(screen.getByText(modelId)).toHaveClass('truncate')
  fireEvent.click(trigger)
  // 입력창 아래에서 열리므로 위로 펼치는 Popover(포털·뷰포트 충돌 회피)에 담는다
  const popup = await screen.findByRole('dialog', { name: 'AI 모델' })
  expect(popup).toContainElement(screen.getByRole('button', { name: '모델 목록 새로고침' }))
  expect(popup).toHaveClass('w-[min(22rem,calc(100vw-2rem))]')
  expect(popup).toHaveAttribute('data-side', 'top')
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText(/^이 대화:/).parentElement).toHaveClass('bg-muted')
  expect(screen.getByText(/이\(가\) 서버 모델 목록에 없습니다/)).toHaveClass('bg-tone-warning-bg', 'text-tone-warning-fg')
})

/** 라우터 위치 — 설정 열기가 어디로 가는지 본다 */
function Location() { const { pathname, search } = useLocation(); return <output data-testid="location">{pathname}{search}</output> }

it('popover header tells that a model picked here applies to this conversation only; a System Owner gets "open agent settings" → editor with the model pointer', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/llm/models' ? jsonResponse(200, { models: ['m'] }) : jsonResponse(200, {})))
  renderWithProviders(<MeContext value={{ id: 'u', name: '운영자', role: '', email: null, emailIsDefault: false, roles: ['system_owner'], theme: 'system', locale: 'ko' }}><ModelPicker task={task} assistant={assistant} /><Location /></MeContext>, { route: '/c/t' })
  const trigger = screen.getByTitle('이 대화의 모델 변경')
  expect(trigger).toHaveAttribute('data-tour', 'model')
  fireEvent.click(trigger)
  const popup = await screen.findByRole('dialog', { name: 'AI 모델' })
  expect(within(popup).getByText('여기서 바꾼 AI 모델은 이 대화에만 적용돼요.')).toBeInTheDocument()
  expect(within(popup).getByText('에이전트 설정 자체를 바꾸고 싶으세요?')).toBeInTheDocument()
  expect(within(popup).queryByText(/System Owner가 바꿔요/)).not.toBeInTheDocument()
  expect(within(popup).queryByRole('link', { name: /OpenWebUI에서 열기/ })).not.toBeInTheDocument() // 연결 모델·규칙이 없으면 링크 없음
  fireEvent.click(within(popup).getByRole('button', { name: '에이전트 설정 열기' }))
  expect(screen.getByTestId('location')).toHaveTextContent('/assistants/manage?edit=a&point=model')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI 모델' })).not.toBeInTheDocument())
})

it('non-owners are told the agent owner (by name) or a System Owner changes agent settings, with an OpenWebUI link when one resolves', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/llm/models') return jsonResponse(200, { models: ['m'] })
    if (url === '/api/catalog/users') return jsonResponse(200, [{ id: 'o', name: '담당 김', initials: '김', color: '#123456', isSystemOwner: false, isBusinessOwner: true }])
    if (url === '/api/settings') return jsonResponse(200, { link1Rule: 'https://owui.example/?model={modelId}' })
    return jsonResponse(200, {})
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><ModelPicker task={task} assistant={{ ...assistant, ownerId: 'o' }} /></MeContext>)
  fireEvent.click(screen.getByTitle('이 대화의 모델 변경'))
  const popup = await screen.findByRole('dialog', { name: 'AI 모델' })
  expect(await within(popup).findByText('에이전트 설정은 담당자(담당 김)나 System Owner가 바꿔요.')).toBeInTheDocument()
  expect(within(popup).queryByRole('button', { name: '에이전트 설정 열기' })).not.toBeInTheDocument()
  const link = await within(popup).findByRole('link', { name: 'OpenWebUI에서 열기' })
  expect(link).toHaveAttribute('href', 'https://owui.example/?model=default-model')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noreferrer')
  expect(link.querySelector('svg')).toHaveTextContent('OW')
  expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  expect(link.querySelector('svg')).toHaveAttribute('data-icon', 'inline-end')
  expect(link.querySelector('.lucide-external-link')).toBeNull()
})
