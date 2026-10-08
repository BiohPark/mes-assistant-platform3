import { render, screen } from '@testing-library/react'
import { Bot } from 'lucide-react'
import { expect, it } from 'vitest'
import { EmptyState } from './EmptyState'

it('renders title, description, children and action in order', () => {
  render(<EmptyState icon={Bot} title="제목" description="설명" action={<button type="button">실행</button>}><span>부가 내용</span></EmptyState>)
  expect(screen.getByText('제목')).toBeInTheDocument()
  expect(screen.getByText('설명')).toBeInTheDocument()
  expect(screen.getByText('부가 내용')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '실행' })).toBeInTheDocument()
  const text = screen.getByText('제목').parentElement!.textContent!
  expect(text.indexOf('제목')).toBeLessThan(text.indexOf('설명'))
  expect(text.indexOf('설명')).toBeLessThan(text.indexOf('부가 내용'))
  expect(text.indexOf('부가 내용')).toBeLessThan(text.indexOf('실행'))
})

it('omits optional parts when absent', () => {
  const { container } = render(<EmptyState icon={Bot} title="제목만" />)
  expect(container.textContent).toBe('제목만')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
