import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { SuggestInput, type Option, type SuggestInputProps } from './SuggestInput'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './ui/sheet'

const choices: Option[] = [
  { value: 'b', label: 'Beta Alpha', hint: 'Second', group: 'Team' },
  { value: 'a', label: 'Alpha', hint: 'First' },
  { value: 'c', label: 'Café' },
]
const source = () => choices
function Single(props: Partial<Extract<SuggestInputProps, { mode: 'single' }>>) {
  const [value, onChange] = useState<Option | null>(null)
  return <SuggestInput mode="single" value={value} onChange={onChange} source={source} aria-label="Choose" {...props} />
}
function Multi() {
  const [value, onChange] = useState<Option[]>([choices[0], choices[1]])
  return <SuggestInput mode="multi" value={value} onChange={onChange} source={source} aria-label="Choose" />
}

describe('SuggestInput', () => {
  it('filters NFC and case-insensitively, prioritizes prefixes, and exposes active options', async () => {
    render(<Single />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'ALP' } })
    const options = await screen.findAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual(['AlphaFirst', 'TeamBeta AlphaSecond'])
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Alpha 제거' })).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Cafe\u0301' } })
    expect(await screen.findByRole('option')).toHaveTextContent('Café')
  })

  it('closes with Escape without selecting and Tab commits while advancing focus', async () => {
    const user = userEvent.setup()
    render(<><Single /><button>Next</button></>)
    const input = screen.getByRole('combobox')
    await user.click(input)
    await screen.findAllByRole('option')
    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).not.toHaveAttribute('aria-activedescendant')
    expect(screen.queryByRole('button', { name: /제거/ })).not.toBeInTheDocument()
    await user.type(input, 'Alpha')
    await screen.findAllByRole('option')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Alpha 제거' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
  })

  it('ignores Enter during IME composition', async () => {
    const onChange = vi.fn()
    render(<Single onChange={onChange} allowCreate />)
    const input = screen.getByRole('combobox')
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '새 값' } })
    await screen.findByRole('option')
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ value: '새 값', label: '새 값' })
  })

  it('removes only the last multi value on empty Backspace and excludes selected values', async () => {
    render(<Multi />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(await screen.findByRole('option')).toHaveTextContent('Café')
    fireEvent.change(input, { target: { value: 'z' } })
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(screen.getByRole('button', { name: 'Alpha 제거' })).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(screen.queryByRole('button', { name: 'Alpha 제거' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta Alpha 제거' })).toBeInTheDocument()
  })

  it('creates trimmed NFC values and supports single removal and re-editing', async () => {
    render(<Single allowCreate />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '  New  ' } })
    expect(await screen.findByRole('option')).toHaveTextContent('새로 추가: New')
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'New 수정' }))
    expect(input).toHaveValue('New')
    fireEvent.change(input, { target: { value: 'Alpha' } })
    await screen.findAllByRole('option')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByRole('button', { name: 'New 제거' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Alpha 제거' }))
    expect(screen.queryByRole('button', { name: /제거/ })).not.toBeInTheDocument()
  })

  it('reports invalid input when creation is forbidden and clears it on edit', async () => {
    const onChange = vi.fn()
    render(<Single onChange={onChange} invalidMessage="Pick a known value" />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Unknown' } })
    await screen.findByText('검색 결과가 없습니다')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a known value')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', screen.getByRole('alert').id)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Alpha' } })
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('limits quick picks to six, selects them, and does not duplicate selected values', () => {
    const picks = Array.from({ length: 7 }, (_, i) => ({ value: String(i), label: `Pick ${i}` }))
    render(<Single quickPicks={picks} />)
    expect(screen.getAllByRole('button')).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: 'Pick 0' }))
    expect(screen.getByRole('button', { name: 'Pick 0 제거' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pick 0' })).not.toBeInTheDocument()
  })

  it('ignores stale async results and failures after a newer query', async () => {
    const pending = new Map<string, { resolve: (value: Option[]) => void; reject: (error: Error) => void }>()
    const asyncSource = (q: string) => new Promise<Option[]>((resolve, reject) => pending.set(q, { resolve, reject }))
    render(<Single source={asyncSource} />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'old-success' } })
    fireEvent.change(input, { target: { value: 'old' } })
    expect(await screen.findByRole('status')).toHaveTextContent('불러오는 중')
    fireEvent.change(input, { target: { value: 'new' } })
    await act(async () => pending.get('new')!.resolve([{ value: 'n', label: 'New' }]))
    expect(await screen.findByRole('option')).toHaveTextContent('New')
    await act(async () => pending.get('old-success')!.resolve([{ value: 'old', label: 'Old' }]))
    expect(screen.getByRole('option')).toHaveTextContent('New')
    await act(async () => pending.get('old')!.reject(new Error('stale')))
    expect(screen.getByRole('option')).toHaveTextContent('New')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces source failures without allowing accidental creation', async () => {
    const onChange = vi.fn()
    render(<Single source={async () => { throw new Error('offline') }} onChange={onChange} allowCreate />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Unknown' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('추천을 불러오지 못했습니다')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not select or create while an async lookup is pending', async () => {
    let resolve!: (options: Option[]) => void
    const onChange = vi.fn()
    render(<Single source={() => new Promise<Option[]>(done => { resolve = done })} onChange={onChange} allowCreate />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Alpha' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => resolve(choices))
    expect(await screen.findAllByRole('option')).toHaveLength(2)
    expect(screen.queryByText('새로 추가: Alpha')).not.toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(choices[1])
  })

  it('deduplicates option values and prevents disabled changes', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<Single onChange={onChange} source={() => [...choices, { value: 'A', label: 'Duplicate' }]} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(await screen.findAllByRole('option')).toHaveLength(3)
    rerender(<Single onChange={onChange} disabled value={choices[1]} quickPicks={[choices[0]]} />)
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).not.toHaveAttribute('aria-activedescendant')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Alpha 제거' }))
    fireEvent.click(screen.getByRole('button', { name: 'Beta Alpha' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('creates NFC values in multi mode without duplicates and supports quick picks', async () => {
    function CreateMulti() {
      const [value, onChange] = useState<Option[]>([])
      return <SuggestInput mode="multi" value={value} onChange={onChange} source={() => []} allowCreate quickPicks={[choices[0]]} />
    }
    render(<CreateMulti />)
    fireEvent.click(screen.getByRole('button', { name: 'Beta Alpha' }))
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '  Cafe\u0301  ' } })
    expect(await screen.findByRole('option')).toHaveTextContent('새로 추가: Café')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Café 제거' })).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'CAFÉ' } })
    await screen.findByText('검색 결과가 없습니다')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getAllByRole('button', { name: /제거/ })).toHaveLength(2)
  })

  it('dismisses the list with Escape without closing its parent Sheet', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Sheet open onOpenChange={onOpenChange}><SheetContent><SheetTitle>Editor</SheetTitle><SheetDescription>Details</SheetDescription><Single /></SheetContent></Sheet>)
    await user.click(screen.getByRole('combobox'))
    await screen.findAllByRole('option')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Editor' })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('scrolls beyond eight rows and portals outside a clipped sheet while preserving focus', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: `Item ${i}` }))
    render(<Sheet open><SheetContent><SheetTitle>Editor</SheetTitle><SheetDescription>Details</SheetDescription><div data-testid="clip" style={{ overflow: 'hidden', height: 32 }}><Single source={() => many} /></div></SheetContent></Sheet>)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    const list = await screen.findByRole('listbox')
    expect(within(list).getAllByRole('option')).toHaveLength(12)
    expect(screen.getByTestId('clip')).not.toContainElement(list)
    expect(screen.getByRole('dialog')).not.toContainElement(list)
    expect(list).toHaveClass('overflow-y-auto')
    fireEvent.mouseDown(within(list).getAllByRole('option')[11])
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Item 11 제거' })).toBeInTheDocument()
  })

  it('translates generated controls', async () => {
    render(<I18nProvider locale="en"><Single allowCreate /></I18nProvider>)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'New' } })
    expect(await screen.findByRole('option')).toHaveTextContent('Add new: New')
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Remove New' })).toBeInTheDocument()
  })
})


it('uses no plus on single selection/re-edit suggestions and plus Add only for multi input', async () => {
  const { rerender } = render(<Single quickPicks={[choices[0]]} />)
  expect(screen.getByRole('button', { name: 'Beta Alpha' }).querySelector('.lucide-plus')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Beta Alpha' }))
  expect(screen.getByRole('button', { name: 'Beta Alpha 수정' }).querySelector('.lucide-plus')).toBeNull()
  rerender(<Multi />)
  expect(screen.getByRole('combobox')).toHaveAttribute('placeholder', '추가')
  expect(screen.getByRole('combobox').parentElement?.querySelector('.lucide-plus')).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Alpha 제거' })).toBeInTheDocument()
})
