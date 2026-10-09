import { fireEvent, screen } from '@testing-library/react'
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

it('keeps edits and caret local while earlier URL values arrive asynchronously', () => {
  function DelayedUrl() {
    const [q, setQ] = useState('abcd')
    return <><CardMapFilterBar level1Options={[]} level2Options={[]} filters={{ ...emptyHomeFilters(), q }} onChange={() => {}} onReset={() => setQ('')} />
      <button onClick={() => setQ('abXcd')}>Earlier URL</button>
      <button onClick={() => setQ('abXYcd')}>Latest URL</button>
      <button onClick={() => setQ('external')}>External URL</button>
    </>
  }
  renderWithProviders(<DelayedUrl />)
  const input = screen.getByRole('textbox') as HTMLInputElement
  input.focus()
  fireEvent.change(input, { target: { value: 'abXcd', selectionStart: 3, selectionEnd: 3 } })
  expect(input).toHaveValue('abXcd')
  fireEvent.change(input, { target: { value: 'abXYcd', selectionStart: 4, selectionEnd: 4 } })
  expect(input).toHaveValue('abXYcd')
  expect(input.selectionStart).toBe(4)
  fireEvent.click(screen.getByRole('button', { name: 'Earlier URL' }))
  expect(input).toHaveValue('abXYcd')
  expect(input.selectionStart).toBe(4)
  fireEvent.click(screen.getByRole('button', { name: 'Latest URL' }))
  expect(input).toHaveValue('abXYcd')
  expect(input.selectionStart).toBe(4)
  fireEvent.click(screen.getByRole('button', { name: 'External URL' }))
  expect(input).toHaveValue('external')
})

it('does not replace a Korean composition draft when a delayed URL update arrives', () => {
  function DelayedUrl() {
    const [q, setQ] = useState('old')
    const [submitted, setSubmitted] = useState('')
    return <><CardMapFilterBar level1Options={[]} level2Options={[]} filters={{ ...emptyHomeFilters(), q }} onChange={patch => setSubmitted(patch.q ?? '')} onReset={() => setQ('')} />
      <button onClick={() => setQ('older response')}>Delayed URL</button>
      <output data-testid="submitted">{submitted}</output>
    </>
  }
  renderWithProviders(<DelayedUrl />)
  const input = screen.getByRole('textbox')
  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: 'old한' } })
  fireEvent.click(screen.getByRole('button', { name: 'Delayed URL' }))
  expect(input).toHaveValue('old한')
  expect(screen.getByTestId('submitted')).toBeEmptyDOMElement()
  fireEvent.change(input, { target: { value: 'old한글' } })
  fireEvent.compositionEnd(input, { data: '한글' })
  expect(input).toHaveValue('old한글')
  expect(screen.getByTestId('submitted')).toHaveTextContent('old한글')
})

it('scrolls filter chips in one mobile row and keeps count and reset outside that row', () => {
  renderWithProviders(<CardMapFilterBar
    level1Options={[{ id: 'l1', label: '긴 상위 분류' }]} level2Options={[{ id: 'l2', label: '긴 하위 분류' }]}
    filters={{ ...emptyHomeFilters(), level1CodeIds: ['l1'], level2CodeIds: ['l2'] }} onChange={() => {}} onReset={() => {}} />)
  const first = screen.getByRole('button', { name: '긴 상위 분류' }).parentElement!
  const second = screen.getByRole('button', { name: '긴 하위 분류' }).parentElement!
  const scroller = first.parentElement!
  expect(scroller).toBe(second.parentElement)
  expect(scroller).toHaveClass('min-w-0', 'max-w-full', 'flex-nowrap', 'overflow-x-auto', 'sm:flex-wrap')
  expect(first).toHaveClass('shrink-0', 'flex-nowrap', 'sm:flex-wrap')
  expect(second).toHaveClass('shrink-0', 'flex-nowrap', 'sm:flex-wrap')
  const controls = screen.getByRole('button', { name: '초기화' }).parentElement!
  expect(controls).toContainElement(screen.getByText('선택됨 2'))
  expect(scroller).not.toContainElement(controls)
  expect(controls).toHaveClass('w-full', 'sm:w-auto')
  expect(scroller.parentElement).toHaveClass('min-w-0')
})
