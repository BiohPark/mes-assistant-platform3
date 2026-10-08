import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MeContext } from '@/app/auth'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { SrManagePage } from './SrManagePage'

vi.mock('@/app/TopBar', () => ({ TopBar: () => null }))
afterEach(() => vi.unstubAllGlobals())

it('inbox 표는 초안을 제외하고 코드·제목·본문 검색 및 상태 칩을 적용해 Sheet를 연다', async () => {
  const rows = [
    { id: 'a', code: 'SR-2026-0001', title: '알람', body: '설비 오류', status: 'submitted' },
    { id: 'b', code: 'SR-2026-0002', title: '리포트', body: '통계 분석', status: 'done' },
    { id: 'draft', code: '', title: '초안', body: '', status: 'draft' },
  ].map(row => ({ ...row, requesterId: 'requester', titleSource: 'manual', attachmentIds: [], threadId: `thread-${row.id}`, results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01', submittedAt: '2026-10-01' }))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/service-requests?scope=inbox') return jsonResponse(200, rows)
    if (url === '/api/service-requests/a') return jsonResponse(200, rows[0])
    if (url === '/api/catalog/users') return jsonResponse(200, [{ id: 'requester', name: '김요청', initials: '김', color: '#000000', isSystemOwner: false, isBusinessOwner: true }])
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrManagePage /></MeContext></TooltipProvider>)
  const table = await screen.findByRole('table')
  await within(table).findByText('알람')
  expect(within(table).queryByText('초안')).not.toBeInTheDocument()
  expect(within(table).getAllByText('김요청')).toHaveLength(2)
  const search = screen.getByRole('textbox', { name: 'SR 검색' })
  await userEvent.type(search, '통계')
  expect(within(table).queryByText('알람')).not.toBeInTheDocument()
  expect(within(table).getByText('리포트')).toBeInTheDocument()
  await userEvent.clear(search)
  await userEvent.type(search, '0001')
  expect(within(table).getByText('알람')).toBeInTheDocument()
  expect(within(table).queryByText('리포트')).not.toBeInTheDocument()
  await userEvent.clear(search)
  await userEvent.type(search, '리포트')
  expect(within(table).getByText('리포트')).toBeInTheDocument()
  await userEvent.clear(search)
  await userEvent.click(screen.getByRole('button', { name: '접수됨' }))
  expect(within(table).queryByText('리포트')).not.toBeInTheDocument()
  await userEvent.click(within(table).getByRole('button', { name: /SR-2026-0001/ }))
  const sheet = await screen.findByRole('dialog')
  expect(within(sheet).getByText('설비 오류')).toBeInTheDocument()
  expect(within(sheet).getByRole('button', { name: '다음 단계: 검토 중' })).toBeInTheDocument()
  await userEvent.click(within(sheet).getByRole('button', { name: '닫기' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

const me = { id: 'u', name: '사용자', role: '', roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }
const row = (id: string, status: string, title = `요청 ${id}`) => ({ id, code: `SR-${id}`, title, body: '', status, requesterId: 'requester', titleSource: 'manual', attachmentIds: [], threadId: `thread-${id}`, results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01', submittedAt: '2026-10-01' })

it('불러오는 동안 뼈대를 보이고 끝나면 표를 그린다', async () => {
  let release!: () => void
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/service-requests?scope=inbox') { await new Promise<void>(resolve => { release = resolve }); return jsonResponse(200, [row('x', 'submitted')]) }
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={me}><SrManagePage /></MeContext></TooltipProvider>)
  expect((await screen.findByText('불러오는 중…')).closest('[aria-busy="true"]')).not.toBeNull()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  release()
  expect(await screen.findByRole('table')).toHaveTextContent('요청 x')
  expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument()
})

it('조회 실패는 경고와 다시 시도를 보이고 재시도 성공 시 표를 그린다', async () => {
  let calls = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/service-requests?scope=inbox') return ++calls === 1 ? jsonResponse(500, { message: '서버 오류' }) : jsonResponse(200, [row('y', 'reviewing')])
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={me}><SrManagePage /></MeContext></TooltipProvider>)
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('요청 목록을 불러오지 못했습니다')
  expect(alert).toHaveTextContent('서버 오류')
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByRole('table')).toHaveTextContent('요청 y')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('접수된 요청이 없으면(초안만) 빈 상태만 보이고 표·초기화 버튼·집계는 없다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/service-requests?scope=inbox' ? jsonResponse(200, [row('d', 'draft', '초안')]) : jsonResponse(200, [])))
  const { container } = renderWithProviders(<TooltipProvider><MeContext value={me}><SrManagePage /></MeContext></TooltipProvider>)
  expect(await screen.findByText('SR이 없습니다.')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.queryByText('초안')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '검색어 지우기' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '상태 필터 초기화' })).not.toBeInTheDocument()
  expect(container).not.toHaveTextContent(/\d+건/)
})

it('검색·상태 필터로 0건이면 각 조건을 따로 지울 수 있다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/service-requests?scope=inbox' ? jsonResponse(200, [row('a', 'submitted', '알람')]) : jsonResponse(200, [])))
  renderWithProviders(<TooltipProvider><MeContext value={me}><SrManagePage /></MeContext></TooltipProvider>)
  await screen.findByRole('table')
  await userEvent.type(screen.getByRole('textbox', { name: 'SR 검색' }), '없는 검색어')
  expect(screen.getByText('조건에 맞는 요청이 없습니다.')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '상태 필터 초기화' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '검색어 지우기' }))
  expect(screen.getByRole('textbox', { name: 'SR 검색' })).toHaveValue('')
  expect(await screen.findByRole('table')).toHaveTextContent('알람')
  await userEvent.click(screen.getByRole('button', { name: '반려' }))
  expect(screen.getByText('조건에 맞는 요청이 없습니다.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '검색어 지우기' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '상태 필터 초기화' }))
  expect(await screen.findByRole('table')).toHaveTextContent('알람')
  expect(screen.getByRole('button', { name: '전체' })).toHaveAttribute('aria-pressed', 'true')
})
