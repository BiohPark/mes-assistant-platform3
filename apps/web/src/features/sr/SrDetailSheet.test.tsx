import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MeContext } from '@/app/auth'
import type { SrDetail } from '@/api/sr'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { useLocation } from 'react-router'
import { SrDetailSheet } from './SrDetailSheet'

const sr: SrDetail = { id: 'internal-sr-uuid', code: 'SR-2026-0001', requesterId: 'internal-requester-uuid', title: '요청', titleSource: 'manual',
  body: '내용', status: 'submitted', attachmentIds: [], candidateAttachmentIds: [], threadId: 'thread-uuid', results: [], conversations: [
    { id: 'internal-task-uuid', code: 'WK-2026-0001', title: '연결 대화', status: 'in_progress', threadId: 'thread' },
  ], createdAt: '2026-10-01', updatedAt: '2026-10-01' }
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

it('요청자 이름과 번역한 상태를 표시하고 내부 ID는 숨긴다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/catalog/users' ? jsonResponse(200, [
    { id: 'internal-requester-uuid', name: '요청한 사람', initials: '요', color: '#000', isSystemOwner: false, isBusinessOwner: false },
  ]) : jsonResponse(200, [])))
  const { container } = renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrDetailSheet sr={sr} onSaved={() => undefined} /></MeContext></TooltipProvider>)
  await screen.findByText('요청자 요청한 사람 · 상태 접수됨')
  expect(container).not.toHaveTextContent('internal-requester-uuid')
  expect(container).not.toHaveTextContent('submitted')
  expect(container).not.toHaveTextContent('in_progress')
  expect(screen.getByRole('link', { name: 'WK-2026-0001 연결 대화 (진행 중)' })).toHaveAttribute('href', '/c/internal-task-uuid')
})

it('요청자 목록에 없어도 ID 대신 일반 요청자 이름을 표시한다', () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  const { container } = renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrDetailSheet sr={sr} onSaved={() => undefined} /></MeContext></TooltipProvider>)
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
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrDetailSheet sr={sr} onSaved={() => undefined} /></MeContext></TooltipProvider>)
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
  expect(screen.queryByRole('combobox', { name: 'SR 상태' })).not.toBeInTheDocument()
})

it('상태 select 대신 단계와 다음 단계 버튼을 보여 주고, 사유 없는 전이는 바로 요청한다', async () => {
  const patches: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/service-requests/internal-sr-uuid/status') { patches.push(JSON.parse(String(init?.body))); return jsonResponse(200, { ...sr, status: 'reviewing' }) }
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrDetailSheet sr={sr} onSaved={() => undefined} /></MeContext></TooltipProvider>)
  const steps = screen.getByRole('list', { name: '요청 진행 단계' })
  expect(within(steps).getByText('접수됨')).toHaveAttribute('aria-current', 'step')
  await userEvent.click(screen.getByRole('button', { name: '다음 단계: 검토 중' }))
  await waitFor(() => expect(patches).toEqual([{ status: 'reviewing' }]))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it.each([['반려', 'rejected'], ['완료', 'done']])('다른 상태 메뉴에서 %s를 고르면 사유를 받아 함께 보낸다', async (label, status) => {
  const patches: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/service-requests/internal-sr-uuid/status') { patches.push(JSON.parse(String(init?.body))); return jsonResponse(200, { ...sr, status }) }
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrDetailSheet sr={sr} onSaved={() => undefined} /></MeContext></TooltipProvider>)
  await userEvent.click(screen.getByRole('button', { name: '다른 상태로' }))
  expect(screen.queryByRole('menuitem', { name: '접수됨' })).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole('menuitem', { name: label }))
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveTextContent(`SR ${label} 사유`)
  expect(within(dialog).getByRole('button', { name: '확인' })).toBeDisabled()
  expect(patches).toEqual([])
  await userEvent.type(within(dialog).getByPlaceholderText('사유를 입력하세요'), '범위 밖 요청')
  await userEvent.click(within(dialog).getByRole('button', { name: '확인' }))
  await waitFor(() => expect(patches).toEqual([{ status, reason: '범위 밖 요청' }]))
})

it('상태 이력에 시각·처리자·변경·사유를 보여 준다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  const history = [
    { id: 'h1', at: '2026-10-01T01:00:00.000Z', by: 'u', byName: '요청한 사람', from: 'draft', to: 'submitted' },
    { id: 'h2', at: '2026-10-02T02:00:00.000Z', by: 's', byName: '담당자', from: 'submitted', to: 'rejected', reason: '범위 밖 요청' },
  ]
  const { container } = renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrDetailSheet sr={{ ...sr, status: 'rejected', statusHistory: history }} onSaved={() => undefined} /></MeContext></TooltipProvider>)
  const list = screen.getByRole('list', { name: '상태 이력' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('담당자')
  expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('접수됨 → 반려')
  expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('사유: 범위 밖 요청')
  expect(container).not.toHaveTextContent('rejected')
  expect(screen.queryByRole('button', { name: /다음 단계/ })).not.toBeInTheDocument()
})

function Location() { return <output aria-label="현재 경로">{useLocation().pathname}</output> }

it('Sheet는 접수 첨부·원문 Markdown·연결 상태를 보여주고 생성한 업무로 이동한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/files/file') return jsonResponse(200, { id: 'file', name: '알람.txt', version: 1, size: 10, source: 'upload' })
    if (url === '/api/threads/thread-uuid/messages') return jsonResponse(200, [{ id: 'm', threadId: 'thread-uuid', role: 'user', kind: 'chat', content: '**원문 요청**', status: 'done', attachmentIds: [], createdAt: '2026-10-01' }])
    if (url === '/api/assistants') return jsonResponse(200, [{ id: 'a', name: '접수 도우미', status: 'open', level1: '분류', level2: '하위', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', usageExample: '', color: '#000000', checklistTemplate: [], createdBy: 'u', createdAt: '2026-10-01', updatedAt: '2026-10-01', revision: 0 }])
    if (url.endsWith('/tasks')) return jsonResponse(201, { id: 'created-task' })
    return jsonResponse(200, [])
  }))
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SrDetailSheet sr={{ ...sr, attachmentIds: ['file'] }} onSaved={() => undefined} /><Location /></MeContext></TooltipProvider>)
  expect(await screen.findByText('알람.txt v1')).toBeInTheDocument()
  expect(await screen.findByText('원문 요청', { selector: 'strong' })).toBeInTheDocument()
  await userEvent.click(await screen.findByRole('button', { name: '접수 도우미' }))
  await userEvent.click(screen.getByRole('button', { name: '연결 업무 시작' }))
  await waitFor(() => expect(screen.getByLabelText('현재 경로')).toHaveTextContent('/c/created-task'))
})


it('영문 Sheet의 파일 목록과 SR 액션은 번역된 이름을 사용한다', async () => {
  localStorage.setItem('mes-locale', 'en')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/files/file' ? jsonResponse(200, { id: 'file', name: 'alarm.txt', version: 1, size: 10, source: 'upload' }) : jsonResponse(200, [])))
  renderWithProviders(<TooltipProvider><MeContext value={{ id: 'u', name: 'User', role: '', roles: ['member'], theme: 'system', locale: 'en' }}><SrDetailSheet sr={{ ...sr, attachmentIds: ['file'] }} onSaved={() => undefined} /></MeContext></TooltipProvider>)
  await screen.findByText('alarm.txt v1')
  expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Version history' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start linked task' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next step: Under review' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Other status' })).toBeInTheDocument()
})
