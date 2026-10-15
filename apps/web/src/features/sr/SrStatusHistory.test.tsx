import userEvent from '@testing-library/user-event'
import { screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { SrStatusChange } from '@mes/domain'
import { renderWithProviders } from '@/test/render'
import { SrStatusHistory } from './SrStatusHistory'

const history: SrStatusChange[] = [
  { id: 'latest', at: '2026-10-03T09:00:00Z', by: 'u', byName: '담당자', from: 'in_progress', to: 'done', reason: '처리 완료' },
  { id: 'first', at: '2026-10-01T09:00:00Z', by: 'u', from: 'draft', to: 'submitted' },
  { id: 'hidden', at: '2026-10-04T09:00:00Z', by: 'u', from: 'submitted', to: 'reviewing' },
]
afterEach(() => localStorage.clear())

it('입력 순서와 무관하게 최근의 실제 상태 변경을 표시하고 전체 이력을 키보드로 펼친다', async () => {
  renderWithProviders(<SrStatusHistory history={history} compact />)
  const list = screen.getByRole('list', { name: '상태 이력' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(1)
  expect(list).toHaveTextContent('담당자')
  expect(list).toHaveTextContent('처리 중 → 완료')
  expect(list).toHaveTextContent('사유: 처리 완료')
  expect(within(list).getByRole('time')).toHaveAttribute('dateTime', history[0].at)
  const toggle = screen.getByRole('button', { name: '전체 보기' })
  expect(toggle).toHaveAttribute('aria-controls', list.id)
  toggle.focus()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true')
  expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  await userEvent.keyboard(' ')
  expect(within(list).getAllByRole('listitem')).toHaveLength(1)
})

it('기본 모드는 접수자 화면의 전체 이력을 유지한다', () => {
  renderWithProviders(<SrStatusHistory history={history} />)
  expect(within(screen.getByRole('list', { name: '상태 이력' })).getAllByRole('listitem')).toHaveLength(2)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it.each([{ entries: [] }, { entries: [history[2]] }])('실제 상태 변경이 없으면 빈 안내만 표시한다', ({ entries }) => {
  renderWithProviders(<SrStatusHistory history={entries} compact />)
  expect(screen.getByText('상태 변경 기록이 없습니다.')).toBeInTheDocument()
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('실제 변경이 한 건이면 펼치기 버튼을 표시하지 않는다', () => {
  renderWithProviders(<SrStatusHistory history={[history[0], history[2]]} compact />)
  expect(screen.getByRole('list')).toHaveTextContent('사유: 처리 완료')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
