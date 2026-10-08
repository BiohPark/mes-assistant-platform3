import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import type { Assistant } from '@mes/contracts'
import { ThemeProvider } from 'next-themes'
import { ProfileProvider } from '@/app/profile'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { ManagePage } from './ManagePage'

const assistant = { id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'assistant_level1:SDLC', level2CodeId: 'assistant_level2:분석',
  summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'owner', status: 'open', usageExample: '', color: '#2563eb',
  checklistTemplate: [], createdBy: 'owner', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', revision: 0, imageId: 'image' } as Assistant
let users = [{ id: 'owner', name: '운영자', initials: '운', color: '#123456', isSystemOwner: true, isBusinessOwner: false }]
let assistantRows: Assistant[] = [assistant]
vi.mock('@/app/hooks', () => ({ useAssistants: () => assistantRows, useUsers: () => users }))
afterEach(() => { vi.unstubAllGlobals(); assistantRows = [assistant]; users = [{ id: 'owner', name: '운영자', initials: '운', color: '#123456', isSystemOwner: true, isBusinessOwner: false }] })

it('enables order editing after assistants load and shows every card', () => {
  assistantRows = []
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const page = () => <QueryClientProvider client={client}><MemoryRouter><ThemeProvider attribute="class" defaultTheme="system" storageKey="mes-theme" disableTransitionOnChange><ProfileProvider><MeContext value={{ id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><ManagePage /></TooltipProvider></MeContext></ProfileProvider></ThemeProvider></MemoryRouter></QueryClientProvider>
  const { container, rerender } = render(page())
  expect(screen.getByRole('button', { name: '순서 편집' })).toBeDisabled()

  assistantRows = [assistant, { ...assistant, id: 'b', name: '두 번째 도우미', order: 2 }]
  rerender(page())
  const editOrder = screen.getByRole('button', { name: '순서 편집' })
  expect(editOrder).toBeEnabled()
  fireEvent.click(editOrder)
  expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(assistantRows.length)
})

it('removes an image without submitting unsaved assistant edits', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/codes?includeInactive=true') return jsonResponse(200, [])
    return jsonResponse(200, {})
  }))
  renderWithProviders(<MeContext value={{ id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><ManagePage /></TooltipProvider></MeContext>)
  fireEvent.click(screen.getByRole('button', { name: '편집' }))
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '저장하지 않은 이름' } })
  expect(screen.getByRole('button', { name: '이미지 제거' })).toHaveAttribute('type', 'button')
  fireEvent.click(screen.getByRole('button', { name: '이미지 제거' }))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/assistants/a/image' && init?.method === 'DELETE')).toBe(true))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(calls.some(([url, init]) => url === '/api/assistants/a' && init?.method === 'PATCH')).toBe(false)
  expect(screen.getByRole('dialog', { name: '에이전트 편집' })).toBeInTheDocument()
})


it('관리 표·검색·편집기에서 내부 ID를 노출하지 않는다', async () => {
  assistantRows = [{ ...assistant, id: 'internal-agent-uuid' }]
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/llm/models' ? jsonResponse(200, { models: ['mapped-model'] }) : jsonResponse(200, [])))
  const { container } = renderWithProviders(<MeContext value={{ id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system', locale: 'ko' }}><TooltipProvider><ManagePage /></TooltipProvider></MeContext>)
  expect(container).not.toHaveTextContent('internal-agent-uuid')
  expect(container).not.toHaveTextContent('open')
  fireEvent.change(screen.getByPlaceholderText('에이전트 검색'), { target: { value: 'internal-agent-uuid' } })
  expect(screen.queryByRole('button', { name: '편집' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByPlaceholderText('에이전트 검색'), { target: { value: '도우미' } })
  fireEvent.click(screen.getByRole('button', { name: '편집' }))
  expect(screen.queryByLabelText('ID')).not.toBeInTheDocument()
  expect(container).not.toHaveTextContent('internal-agent-uuid')
  expect(screen.getByLabelText('연결 모델')).toBeInTheDocument()
  expect(screen.getByLabelText('OpenWebUI 링크(비우면 설정 규칙)')).toBeInTheDocument()
  expect(screen.getByLabelText('설명 문서 주소')).toBeInTheDocument()
  expect(screen.getByLabelText('첫 질문 예시')).toBeInTheDocument()
  await waitFor(() => expect(container.querySelector('option[value="mapped-model"]')).not.toBeNull())
})

it('새 에이전트는 ID 없이 생성하고 연결 모델을 직접 입력할 수 있다', async () => {
  let body: Record<string, unknown> | undefined
  const codes = [
    { id: 'l1', groupKey: 'assistant_level1', code: 'SDLC', name: 'SDLC', sortOrder: 1, active: true },
    { id: 'l2', groupKey: 'assistant_level2', code: '분석', name: '분석', sortOrder: 1, active: true },
  ]
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/codes?includeInactive=true') return jsonResponse(200, codes)
    if (url === '/api/llm/models') return jsonResponse(200, { models: ['suggested-model'] })
    if (url === '/api/assistants' && init?.method === 'POST') { body = JSON.parse(String(init.body)) as Record<string, unknown>; return jsonResponse(201, { ...assistant, id: 'a-123456789abc' }) }
    return jsonResponse(200, {})
  }))
  renderWithProviders(<MeContext value={{ id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system', locale: 'ko' }}><TooltipProvider><ManagePage /></TooltipProvider></MeContext>)
  fireEvent.click(screen.getByRole('button', { name: '새 에이전트' }))
  expect(screen.queryByLabelText('ID')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '새 도우미' } })
  fireEvent.change(screen.getByRole('combobox', { name: '분류 1' }), { target: { value: '새 분류' } })
  await screen.findByRole('option', { name: '새로 추가: 새 분류' })
  fireEvent.keyDown(screen.getByRole('combobox', { name: '분류 1' }), { key: 'Enter' })
  fireEvent.change(screen.getByRole('combobox', { name: '분류 2' }), { target: { value: '새 하위' } })
  await screen.findByRole('option', { name: '새로 추가: 새 하위' })
  fireEvent.keyDown(screen.getByRole('combobox', { name: '분류 2' }), { key: 'Enter' })
  fireEvent.change(screen.getByLabelText('연결 모델'), { target: { value: 'custom-model' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(body).toMatchObject({ name: '새 도우미', modelId: 'custom-model', ownerId: 'owner', level1: '새 분류', level2: '새 하위' }))
  expect(body).not.toHaveProperty('id')
})

it.each([false, true])('편집 저장은 바꾸지 않은 분류 ID를 보존하고 변경한 분류만 이름으로 보낸다: %s', async changeLevel1 => {
  let body: Record<string, unknown> | undefined
  const codes = [
    { id: 'assistant_level1:MANUAL', groupKey: 'assistant_level1', code: 'MANUAL', name: 'SDLC', sortOrder: 0, active: true, isAuto: false },
    { id: assistant.level1CodeId, groupKey: 'assistant_level1', code: 'SDLC', name: 'SDLC', sortOrder: 1, active: true, isAuto: true },
  ]
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/codes?includeInactive=true') return jsonResponse(200, codes)
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    if (url === '/api/assistants/a' && init?.method === 'PATCH') { body = JSON.parse(String(init.body)); return jsonResponse(200, assistant) }
    return jsonResponse(200, {})
  }))
  renderWithProviders(<MeContext value={{ id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system', locale: 'ko' }}><TooltipProvider><ManagePage /></TooltipProvider></MeContext>)
  fireEvent.click(screen.getByRole('button', { name: '편집' }))
  fireEvent.change(screen.getByLabelText('설명'), { target: { value: '설명만 수정' } })
  if (changeLevel1) {
    fireEvent.change(screen.getByRole('combobox', { name: '분류 1' }), { target: { value: '새 분류' } })
    await screen.findByRole('option', { name: '새로 추가: 새 분류' })
    fireEvent.keyDown(screen.getByRole('combobox', { name: '분류 1' }), { key: 'Enter' })
  }
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(body).toMatchObject({ summary: '설명만 수정', level2CodeId: assistant.level2CodeId }))
  expect(body).not.toHaveProperty('level2')
  if (changeLevel1) {
    expect(body).toHaveProperty('level1', '새 분류')
    expect(body).not.toHaveProperty('level1CodeId')
  } else {
    expect(body).toHaveProperty('level1CodeId', assistant.level1CodeId)
    expect(body).not.toHaveProperty('level1')
  }
})

it('코드 탭은 두 분류 섹션·사용 수·자동 배지를 표시하고 추가 폼은 없다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [
    { id: assistant.level1CodeId, groupKey: 'assistant_level1', code: 'SDLC', name: 'SDLC', sortOrder: 1, active: true, isAuto: false },
    { id: assistant.level2CodeId, groupKey: 'assistant_level2', code: '분석', name: '분석', sortOrder: 2, active: true, isAuto: true },
  ])))
  renderWithProviders(<MeContext value={{ id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system', locale: 'ko' }}><TooltipProvider><ManagePage /></TooltipProvider></MeContext>)
  fireEvent.click(screen.getByRole('button', { name: '분류 코드' }))
  expect(await screen.findByRole('heading', { name: '분류 1' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '분류 2' })).toBeInTheDocument()
  expect(await screen.findByText('자동')).toBeInTheDocument()
  expect(screen.getAllByText('사용 1')).toHaveLength(2)
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '추가' })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'SDLC 이름' })).toHaveValue('SDLC')
  expect(screen.getByRole('spinbutton', { name: '분석 순서' })).toHaveValue(2)
  expect(screen.getAllByRole('checkbox', { name: '활성' })).toHaveLength(2)
})

it('코드 이름·순서·활성을 계속 수정하고 비활성 코드도 관리 목록에 유지한다', async () => {
  const item = { id: 'assistant_level1:SDLC', groupKey: 'assistant_level1', code: 'SDLC', name: 'SDLC', sortOrder: 1, active: true, isAuto: false }
  const patches: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') { const patch: unknown = JSON.parse(String(init.body)); patches.push(patch); Object.assign(item, patch); return jsonResponse(200, item) }
    if (url === '/api/codes?includeInactive=true') return jsonResponse(200, [item])
    return jsonResponse(200, [])
  }))
  renderWithProviders(<MeContext value={{ id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system', locale: 'ko' }}><TooltipProvider><ManagePage /></TooltipProvider></MeContext>)
  fireEvent.click(screen.getByRole('button', { name: '분류 코드' }))
  const name = await screen.findByRole('textbox', { name: 'SDLC 이름' })
  fireEvent.change(name, { target: { value: '새 이름' } })
  fireEvent.blur(name)
  const order = await screen.findByRole('spinbutton', { name: '새 이름 순서' })
  fireEvent.change(order, { target: { value: '4' } })
  fireEvent.blur(order)
  await waitFor(() => expect(patches).toContainEqual({ sortOrder: 4 }))
  fireEvent.click(screen.getByRole('checkbox', { name: '활성' }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '활성' })).not.toBeChecked())
  expect(screen.getByRole('textbox', { name: '새 이름 이름' })).toHaveValue('새 이름')
  expect(patches).toEqual([{ name: '새 이름' }, { sortOrder: 4 }, { active: false }])
})
