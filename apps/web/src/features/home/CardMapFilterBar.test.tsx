import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it } from 'vitest'
import { emptyHomeFilters } from '@/app/uiStore'
import { renderWithProviders } from '@/test/render'
import { CardMapFilterBar } from './CardMapFilterBar'

it('opens a classification popover for keyboard multiple selection, shows selected chips with remove, and resets', async () => {
  function Filter() {
    const [filters, setFilters] = useState(emptyHomeFilters())
    return <CardMapFilterBar level1Options={[{ id: 'l1', label: '상위' }, { id: 'other', label: '다른 상위' }]} level2Options={[{ id: 'sub1', label: '하위 하나' }, { id: 'sub2', label: '하위 둘' }]} filters={filters} onChange={patch => setFilters(current => ({ ...current, ...patch }))} onReset={() => setFilters(emptyHomeFilters())} />
  }
  const user = userEvent.setup()
  renderWithProviders(<Filter />)
  expect(screen.queryByRole('button', { name: '상위' })).not.toBeInTheDocument()
  expect(screen.queryByText(/^선택됨/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '초기화' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '분류' }))
  const popover = await screen.findByRole('dialog', { name: '분류' })
  expect(screen.getByRole('toolbar', { name: '업무 Lv1' })).toBeInTheDocument()
  expect(screen.getByRole('toolbar', { name: '업무 Lv2' })).toBeInTheDocument()
  const first = screen.getByRole('button', { name: '상위' })
  expect(first).toHaveAttribute('aria-pressed', 'false')
  first.focus()
  await user.keyboard(' {ArrowRight} ')
  expect(first).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '다른 상위' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: '하위 하나' }))
  await user.click(screen.getByRole('button', { name: '하위 둘' }))
  expect(popover).toBeInTheDocument()
  expect(screen.getByText('선택됨 4')).toBeInTheDocument()
  expect(first).toHaveClass('data-[state=on]:bg-primary', 'data-[state=on]:text-primary-foreground', 'hover:border-foreground')
  expect(first.querySelector('svg')).not.toBeNull()
  // 팝오버 밖을 누르면 닫히고, 고른 것만 칩으로 남아 ×로 하나씩 뺀다
  await user.click(screen.getByRole('button', { name: '하위 둘 해제' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '분류' })).not.toBeInTheDocument())
  expect(screen.getByText('선택됨 3')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '하위 둘 해제' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '초기화' }))
  expect(screen.queryByRole('button', { name: /해제$/ })).not.toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('button', { name: '초기화' })).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: '분류' }))
  expect(await screen.findByRole('button', { name: '상위' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('button', { name: '하위 둘' })).toHaveAttribute('aria-pressed', 'false')
})

it('keeps the retired switch inside the filter popover and shows reset for a search term alone', async () => {
  function Filter() {
    const [filters, setFilters] = useState(emptyHomeFilters())
    return <CardMapFilterBar level1Options={[]} level2Options={[]} filters={filters} onChange={patch => setFilters(current => ({ ...current, ...patch }))} onReset={() => setFilters(emptyHomeFilters())} />
  }
  const user = userEvent.setup()
  renderWithProviders(<Filter />)
  expect(screen.getByRole('button', { name: '분류' })).toBeDisabled()
  expect(screen.queryByRole('switch', { name: '폐기 표시' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '필터' }))
  await user.click(await screen.findByRole('switch', { name: '폐기 표시' }))
  expect(screen.getByRole('switch', { name: '폐기 표시' })).toBeChecked()
  expect(screen.getByText('선택됨 1')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '초기화' }))
  expect(screen.queryByText(/^선택됨/)).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } })
  expect(await screen.findByRole('button', { name: '초기화' })).toBeInTheDocument()
  expect(screen.queryByText(/^선택됨/)).not.toBeInTheDocument()
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

it('shows selected chips that wrap without a scroller and keeps count and reset together', () => {
  renderWithProviders(<CardMapFilterBar
    level1Options={[{ id: 'l1', label: '긴 상위 분류' }]} level2Options={[{ id: 'l2', label: '긴 하위 분류' }]}
    filters={{ ...emptyHomeFilters(), level1CodeIds: ['l1'], level2CodeIds: ['l2'] }} onChange={() => {}} onReset={() => {}} />)
  const first = screen.getByRole('button', { name: '긴 상위 분류 해제' }).parentElement!
  const second = screen.getByRole('button', { name: '긴 하위 분류 해제' }).parentElement!
  expect(first).toHaveTextContent('긴 상위 분류')
  expect(second).toHaveTextContent('긴 하위 분류')
  expect(first.parentElement).toBe(second.parentElement)
  expect(first).toHaveClass('shrink-0')
  const controls = screen.getByRole('button', { name: '초기화' }).parentElement!
  expect(controls).toContainElement(screen.getByText('선택됨 2'))
  expect(controls).toHaveClass('ml-auto')
})
