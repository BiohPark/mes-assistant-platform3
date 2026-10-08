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
  expect(within(sheet).getByRole('combobox', { name: 'SR 상태' })).toHaveValue('submitted')
  await userEvent.click(within(sheet).getByRole('button', { name: '닫기' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
