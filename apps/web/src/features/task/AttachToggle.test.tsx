import { fireEvent, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { AttachToggle, UsedMark } from './AttachToggle'

it('[첨부] 버튼은 이름이 고정이고 첨부 중이면 눌림·"첨부됨"으로 보인다', () => {
  const onToggle = vi.fn()
  const { rerender } = renderWithProviders(<AttachToggle label="spec.txt" attached={false} onToggle={onToggle} />)
  const button = screen.getByRole('button', { name: 'spec.txt 첨부' })
  expect(button).toHaveAttribute('aria-pressed', 'false')
  expect(button).toHaveTextContent('첨부')
  fireEvent.click(button)
  expect(onToggle).toHaveBeenCalledOnce()
  rerender(<AttachToggle label="spec.txt" attached onToggle={onToggle} />)
  expect(screen.getByRole('button', { name: 'spec.txt 첨부' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'spec.txt 첨부' })).toHaveTextContent('첨부됨')
})

it('누르는 영역은 32px(h-8)이고 비활성화할 수 있다', () => {
  renderWithProviders(<AttachToggle label="spec.txt" attached={false} disabled onToggle={() => {}} />)
  const button = screen.getByRole('button', { name: 'spec.txt 첨부' })
  expect(button).toHaveClass('h-8')
  expect(button).toBeDisabled()
})

it('사용됨은 작은 표시이고 설명은 툴팁(title)에 둔다', () => {
  renderWithProviders(<UsedMark testId="used-f" />)
  const mark = screen.getByTestId('used-f')
  expect(mark).toHaveTextContent('사용됨')
  expect(mark).toHaveAttribute('title', '이 대화의 질문에 함께 보낸 적이 있습니다')
  expect(mark).toHaveClass('text-muted-foreground')
})
