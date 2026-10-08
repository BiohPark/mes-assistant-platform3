import { fireEvent, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { InputToggle } from './InputToggle'

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
