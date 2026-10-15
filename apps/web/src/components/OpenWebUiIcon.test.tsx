import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import { OpenWebUiIcon } from './OpenWebUiIcon'

it('renders a decorative OW badge with lucide dimensions and inherited color', () => {
  const { container } = render(<OpenWebUiIcon />)
  const icon = container.querySelector('svg')!
  expect(icon).toHaveAttribute('viewBox', '0 0 24 24')
  expect(icon).toHaveAttribute('width', '24')
  expect(icon).toHaveAttribute('height', '24')
  expect(icon).toHaveAttribute('stroke', 'currentColor')
  expect(icon).toHaveAttribute('aria-hidden', 'true')
  expect(icon).toHaveAttribute('focusable', 'false')
  expect(icon.querySelector('rect')).not.toBeNull()
  expect(icon.querySelector('text')).toHaveTextContent('OW')
  expect(icon.querySelector('text')).toHaveAttribute('fill', 'currentColor')
})

it('accepts size, class and inline placement props used by links and buttons', () => {
  const { container } = render(<OpenWebUiIcon size={16} className="size-3" data-icon="inline-end" />)
  const icon = container.querySelector('svg')!
  expect(icon).toHaveAttribute('width', '16')
  expect(icon).toHaveAttribute('height', '16')
  expect(icon).toHaveClass('size-3')
  expect(icon).toHaveAttribute('data-icon', 'inline-end')
})
