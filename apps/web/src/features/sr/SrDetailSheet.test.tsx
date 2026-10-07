import { screen } from '@testing-library/react'
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
