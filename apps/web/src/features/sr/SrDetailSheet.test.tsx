import userEvent from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import type { SrDetail } from '@/api/sr'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { SrDetailSheet } from './SrDetailSheet'

const sr: SrDetail = { id: 'internal-sr-uuid', code: 'SR-2026-0001', requesterId: 'internal-requester-uuid', title: '요청', titleSource: 'manual',
  body: '내용', status: 'submitted', attachmentIds: [], threadId: 'thread-uuid', results: [], conversations: [
    { id: 'internal-task-uuid', code: 'WK-2026-0001', title: '연결 대화', status: 'in_progress', threadId: 'thread' },
  ], createdAt: '2026-10-01', updatedAt: '2026-10-01' }
afterEach(() => vi.unstubAllGlobals())

it('요청자 이름과 번역한 상태를 표시하고 내부 ID는 숨긴다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/catalog/users' ? jsonResponse(200, [
    { id: 'internal-requester-uuid', name: '요청한 사람', initials: '요', color: '#000', isSystemOwner: false, isBusinessOwner: false },
  ]) : jsonResponse(200, [])))
  const { container } = renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrDetailSheet sr={sr} onSaved={() => undefined} /></MeContext>)
  await screen.findByText('요청자 요청한 사람 · 상태 접수됨')
  expect(container).not.toHaveTextContent('internal-requester-uuid')
  expect(container).not.toHaveTextContent('submitted')
  expect(container).not.toHaveTextContent('in_progress')
  expect(screen.getByRole('link', { name: 'WK-2026-0001 연결 대화 (진행 중)' })).toHaveAttribute('href', '/c/internal-task-uuid')
})

it('요청자 목록에 없어도 ID 대신 일반 요청자 이름을 표시한다', () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  const { container } = renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrDetailSheet sr={sr} onSaved={() => undefined} /></MeContext>)
  expect(container).not.toHaveTextContent('internal-requester-uuid')
  expect(container).toHaveTextContent('요청자')
})

it('연결 에이전트 추천·검색은 폐기를 제외하고 선택한 에이전트로 업무를 시작한다', async () => {
  const bodies: unknown[] = []
  const base = { level1: '분류', level2: '하위', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', usageExample: '', color: '#000000', checklistTemplate: [], createdBy: 'u', createdAt: '2026-10-01', updatedAt: '2026-10-01', revision: 0 }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return jsonResponse(200, [
      { ...base, id: 'a', name: '추천 도우미', status: 'open' },
      { ...base, id: 'b', name: '검색 도우미', status: 'testing' },
      { ...base, id: 'old', name: '폐기 도우미', status: 'retired' },
    ])
    if (url.endsWith('/tasks')) { bodies.push(JSON.parse(String(init?.body))); return jsonResponse(201, { id: 'created' }) }
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup()
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrDetailSheet sr={sr} onSaved={() => undefined} /></MeContext>)
  expect(screen.getByRole('button', { name: '연결 업무 시작' })).toBeDisabled()
  const pick = await screen.findByRole('button', { name: '추천 도우미' })
  pick.focus(); await user.keyboard('{Enter}')
  await user.click(screen.getByRole('button', { name: '연결 업무 시작' }))
  await waitFor(() => expect(bodies).toEqual([{ assistantId: 'a', forceNew: false }]))
  const picker = screen.getByRole('combobox', { name: '연결 업무 에이전트' })
  await user.click(picker)
  expect(screen.queryByRole('option', { name: '폐기 도우미' })).not.toBeInTheDocument()
  await user.type(picker, '검색')
  await screen.findByRole('option', { name: '검색 도우미' })
  await user.keyboard('{ArrowDown}{Enter}')
  await user.click(screen.getByRole('button', { name: '연결 업무 시작' }))
  await waitFor(() => expect(bodies[1]).toEqual({ assistantId: 'b', forceNew: false }))
  await user.click(screen.getByRole('button', { name: '검색 도우미 제거' }))
  expect(screen.getByRole('button', { name: '연결 업무 시작' })).toBeDisabled()
  expect(screen.getByRole('combobox', { name: 'SR 상태' })).toHaveValue('submitted')
})
