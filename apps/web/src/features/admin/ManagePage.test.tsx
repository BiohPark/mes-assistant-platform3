import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import type { Assistant } from '@mes/contracts'
import { ThemeProvider } from 'next-themes'
import { ProfileProvider } from '@/app/profile'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n'
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
  await waitFor(() => expect(screen.getByRole('dialog', { name: '에이전트 편집' }).querySelector('option[value="mapped-model"]')).not.toBeNull())
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
  fireEvent.click(screen.getByRole('button', { name: '운영자 제거' }))
  expect(screen.queryByRole('button', { name: '운영자 제거' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(body).toBeUndefined()
  expect(screen.getByRole('combobox', { name: '담당자' })).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('combobox', { name: '담당자' })).toHaveAccessibleDescription('담당자를 선택하세요')
  fireEvent.change(screen.getByRole('combobox', { name: '담당자' }), { target: { value: '운영자' } })
  await screen.findByRole('option', { name: '운영자' })
  fireEvent.keyDown(screen.getByRole('combobox', { name: '담당자' }), { key: 'Enter' })
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

it.each([
  { locale: 'ko' as const, tab: '분류 코드', level1: '분류 1', level2: '분류 2', name: '이름', order: '순서', active: '활성', usage: '사용 1', auto: '자동', add: '추가' },
  { locale: 'en' as const, tab: 'Category codes', level1: 'Category 1', level2: 'Category 2', name: 'name', order: 'order', active: 'Active', usage: 'Used 1', auto: 'Auto', add: 'Add' },
])('코드 행은 반복 라벨 없이 입력·스위치·배지를 한 행에 유지한다: $locale', async labels => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [
    { id: assistant.level1CodeId, groupKey: 'assistant_level1', code: 'SDLC', name: 'SDLC', sortOrder: 1, active: true, isAuto: false },
    { id: assistant.level2CodeId, groupKey: 'assistant_level2', code: '분석', name: '분석', sortOrder: 2, active: true, isAuto: true },
  ])))
  renderWithProviders(<MeContext value={{ id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system', locale: labels.locale }}><I18nProvider locale={labels.locale}><TooltipProvider><ManagePage /></TooltipProvider></I18nProvider></MeContext>)
  fireEvent.click(screen.getByRole('button', { name: labels.tab }))
  expect(await screen.findByRole('heading', { name: labels.level1 })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: labels.level2 })).toBeInTheDocument()
  await screen.findByRole('textbox', { name: `SDLC ${labels.name}` })
  expect(screen.getAllByText(labels.usage)).toHaveLength(2)
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: labels.add })).not.toBeInTheDocument()
  for (const [codeName, sortOrder, isAuto] of [['SDLC', 1, false], ['분석', 2, true]] as const) {
    const name = screen.getByRole('textbox', { name: `${codeName} ${labels.name}` })
    expect(name).toHaveValue(codeName)
    const row = name.parentElement!
    expect(row).toHaveClass('flex', 'flex-wrap', 'items-center', 'gap-2')
    const order = within(row).getByRole('spinbutton', { name: `${codeName} ${labels.order}` })
    expect(order).toHaveValue(sortOrder)
    expect(order.parentElement).toBe(row)
    expect(within(row).getByRole('switch', { name: `${codeName} ${labels.active}` })).toBeChecked()
    expect(within(row).getByText(labels.active)).toBeInTheDocument()
    expect(within(row).getByText(labels.usage)).toBeInTheDocument()
    if (isAuto) expect(within(row).getByText(labels.auto)).toBeInTheDocument()
    else expect(within(row).queryByText(labels.auto)).not.toBeInTheDocument()
    expect(within(row).queryByText(`${codeName} ${labels.name}`)).not.toBeInTheDocument()
    expect(within(row).queryByText(`${codeName} ${labels.order}`)).not.toBeInTheDocument()
  }
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
  fireEvent.click(screen.getByRole('switch', { name: '새 이름 활성' }))
  await waitFor(() => expect(screen.getByRole('switch', { name: '새 이름 활성' })).not.toBeChecked())
  expect(screen.getByRole('textbox', { name: '새 이름 이름' })).toHaveValue('새 이름')
  expect(patches).toEqual([{ name: '새 이름' }, { sortOrder: 4 }, { active: false }])
})

it('담당자·상태·필수 항목을 키보드로 변경해 저장하고 담당자 미선택은 거부한다', async () => {
  users.push({ ...users[0]!, id: 'other', name: '다른 담당자' })
  assistantRows = [{ ...assistant, checklistTemplate: [{ id: 'check', label: '검토', required: false }] }]
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants/a' && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>; bodies.push(body)
      return jsonResponse(200, { ...assistantRows[0], ...body })
    }
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup()
  renderWithProviders(<MeContext value={{ id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system', locale: 'ko' }}><TooltipProvider><ManagePage /></TooltipProvider></MeContext>)
  await user.click(screen.getByRole('button', { name: '편집' }))
  expect(screen.getByRole('combobox', { name: '담당자' })).toHaveAttribute('aria-required', 'true')
  await user.click(screen.getByRole('button', { name: '운영자 제거' }))
  await user.click(screen.getByRole('button', { name: /^저장$/ }))
  expect(bodies).toEqual([])
  expect(screen.getByRole('combobox', { name: '담당자' })).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('combobox', { name: '담당자' })).toHaveAccessibleDescription('담당자를 선택하세요')
  await user.click(screen.getByRole('combobox', { name: '담당자' }))
  await user.type(screen.getByRole('combobox', { name: '담당자' }), '다른')
  await screen.findByRole('option', { name: '다른 담당자' })
  await user.keyboard('{ArrowDown}{Enter}')
  const status = screen.getByRole('radio', { name: '개발 중' })
  status.focus()
  await user.keyboard('{ArrowRight} ')
  expect(screen.getByRole('radio', { name: '테스트' })).toBeChecked()
  const required = screen.getByRole('checkbox', { name: '검토 필수' })
  required.focus()
  await user.keyboard(' ')
  expect(required).toBeChecked()
  await user.click(screen.getByRole('button', { name: /^저장$/ }))
  await waitFor(() => expect(bodies).toHaveLength(1))
  expect(bodies[0]).toMatchObject({ ownerId: 'other', status: 'testing', checklistTemplate: [{ id: 'check', label: '검토', required: true }] })
})


it('편집 Sheet는 포커스를 가두고 Escape로 닫은 뒤 편집 버튼에 돌려준다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => jsonResponse(200, url === '/api/llm/models' ? { models: [] } : [])))
  const user = userEvent.setup()
  renderWithProviders(<MeContext value={{ id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system', locale: 'ko' }}><TooltipProvider><ManagePage /></TooltipProvider></MeContext>)
  const trigger = screen.getByRole('button', { name: '편집' })
  await user.click(trigger)
  const sheet = screen.getByRole('dialog', { name: '에이전트 편집' })
  expect(sheet).toHaveAttribute('aria-modal', 'true')
  expect(sheet).toHaveAttribute('data-side', 'right')
  const close = within(sheet).getByRole('button', { name: '닫기' })
  close.focus()
  await user.tab()
  expect(within(sheet).getByRole('textbox', { name: '이름' })).toHaveFocus()
  await user.tab({ shift: true })
  expect(close).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: '에이전트 편집' })).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('에이전트 삭제는 취소·Escape에는 유지하고 확인할 때만 삭제한다', async () => {
  const deleted: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') { deleted.push(url); return jsonResponse(200, {}) }
    return jsonResponse(200, url === '/api/llm/models' ? { models: [] } : [])
  }))
  const user = userEvent.setup()
  renderWithProviders(<MeContext value={{ id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system', locale: 'ko' }}><TooltipProvider><ManagePage /></TooltipProvider></MeContext>)
  await user.click(screen.getByRole('button', { name: '편집' }))
  const trigger = screen.getByRole('button', { name: '삭제' })
  await user.click(trigger)
  const confirm = await screen.findByRole('dialog', { name: '에이전트를 삭제할까요?' })
  expect(deleted).toEqual([])
  await user.click(within(confirm).getByRole('button', { name: '취소' }))
  expect(trigger).toHaveFocus()
  expect(deleted).toEqual([])
  await user.click(trigger)
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: '에이전트를 삭제할까요?' })).not.toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: '에이전트 편집' })).toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(deleted).toEqual([])
  await user.click(trigger)
  await user.click(within(screen.getByRole('dialog', { name: '에이전트를 삭제할까요?' })).getByRole('button', { name: '삭제' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '에이전트 편집' })).not.toBeInTheDocument())
  expect(deleted).toEqual(['/api/assistants/a'])
})
