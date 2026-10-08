import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it } from 'vitest'
import { emptyHomeFilters } from '@/app/uiStore'
import { renderWithProviders } from '@/test/render'
import { CardMapFilterBar } from './CardMapFilterBar'

it('supports keyboard multiple selection, checked visual states, and reset', async () => {
  function Filter() {
    const [filters, setFilters] = useState(emptyHomeFilters())
    return <CardMapFilterBar level1Options={[{ id: 'l1', label: '분류' }, { id: 'other', label: '다른 분류' }]} level2Options={[{ id: 'sub1', label: '하위 하나' }, { id: 'sub2', label: '하위 둘' }]} filters={filters} onChange={patch => setFilters(current => ({ ...current, ...patch }))} onReset={() => setFilters(emptyHomeFilters())} />
  }
  const user = userEvent.setup()
  renderWithProviders(<Filter />)
  const first = screen.getByRole('button', { name: '분류' })
  expect(first).toHaveAttribute('aria-pressed', 'false')
  first.focus()
  await user.keyboard(' {ArrowRight} ')
  expect(first).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '다른 분류' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: '하위 하나' }))
  await user.click(screen.getByRole('button', { name: '하위 둘' }))
  expect(screen.getByText('선택됨 4')).toBeInTheDocument()
  expect(first).toHaveClass('data-[state=on]:bg-primary', 'data-[state=on]:text-primary-foreground', 'hover:border-foreground')
  expect(first.querySelector('svg')).not.toBeNull()
  await user.click(screen.getByRole('button', { name: '초기화' }))
  expect(first).toHaveAttribute('aria-pressed', 'false')
})
