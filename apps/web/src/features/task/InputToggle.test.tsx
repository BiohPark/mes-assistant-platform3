import { fireEvent, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { InputToggle, StagedToggle } from './InputToggle'

it('exposes the reference toggle as a checkbox and reports the weight change', () => {
  const onChange = vi.fn()
  renderWithProviders(<InputToggle label="spec.txt" onChange={onChange} />)
  const box = screen.getByRole('checkbox', { name: 'spec.txt 참고 입력으로 선택' })
  expect(box).not.toBeChecked()
  fireEvent.click(box)
  expect(onChange).toHaveBeenCalledWith('reference')
  expect(screen.getByRole('button', { name: 'spec.txt 주 입력으로 지정' })).toHaveAttribute('aria-pressed', 'false')
})

it('removes the input when a selected file is unchecked', () => {
  const onChange = vi.fn()
  renderWithProviders(<InputToggle label="spec.txt" weight="main" onChange={onChange} />)
  const box = screen.getByRole('checkbox', { name: 'spec.txt 입력 해제' })
  expect(box).toBeChecked()
  fireEvent.click(box)
  expect(onChange).toHaveBeenCalledWith(null)
})

it('disables both controls', () => {
  renderWithProviders(<InputToggle label="spec.txt" disabled onChange={() => {}} />)
  expect(screen.getByRole('checkbox')).toBeDisabled()
  expect(screen.getByRole('button')).toBeDisabled()
})

it('gives both controls a 32px hit area and uses semantic tokens', () => {
  const onChange = vi.fn()
  const { container } = renderWithProviders(<InputToggle label="spec.txt" weight="main" onChange={onChange} />)
  const star = screen.getByRole('button', { name: 'spec.txt 주 입력으로 지정' })
  expect(star).toHaveClass('size-8', 'text-tone-warning-fg')
  const box = screen.getByRole('checkbox')
  expect(box.closest('label')).toHaveClass('size-8')
  fireEvent.click(box.closest('label')!)
  expect(onChange).toHaveBeenCalledWith(null)
  expect(container.innerHTML).not.toMatch(/(?:bg|text|border|fill)-(?:amber|violet|sky)-\d/)
})

it('자료함 행은 담기 체크만 보이고(★ 없음), 보낼 자료 행은 ★·×로 바꾸고 뺀다', () => {
  const onChange = vi.fn()
  renderWithProviders(<><InputToggle label="lib.txt" showMain={false} onChange={onChange} /><StagedToggle label="staged.txt" weight="reference" onChange={onChange} /></>)
  expect(screen.queryByRole('button', { name: 'lib.txt 주 입력으로 지정' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'lib.txt 참고 입력으로 선택' }))
  expect(onChange).toHaveBeenLastCalledWith('reference')
  fireEvent.click(screen.getByRole('button', { name: 'staged.txt 주 입력으로 지정' }))
  expect(onChange).toHaveBeenLastCalledWith('main')
  fireEvent.click(screen.getByRole('button', { name: 'staged.txt 보낼 자료에서 빼기' }))
  expect(onChange).toHaveBeenLastCalledWith(null)
})
