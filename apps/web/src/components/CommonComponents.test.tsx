import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { srTagColor } from '@mes/domain'
import { Chip } from './Chip'
import { Badge } from './ui/badge'
import { Field } from './Field'
import { TagChip } from './TagChip'
import { Checkbox } from './ui/checkbox'
import { RadioGroup, RadioGroupItem } from './ui/radio-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from './ui/sheet'

it('renders value chips with separate selection and removal controls and readonly tone badges', () => {
  const onClick = vi.fn(), onRemove = vi.fn()
  render(<><Chip label="Value" selected onClick={onClick} onRemove={onRemove} /><Chip label="Suggestion" variant="suggestion" onClick={onClick} /><Badge tone="warning">Pending</Badge></>)
  const pick = screen.getByRole('button', { name: 'Value' })
  expect(pick).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Value 제거' }))
  expect(onRemove).toHaveBeenCalledOnce()
  expect(onClick).not.toHaveBeenCalled()
  fireEvent.click(pick)
  expect(onClick).toHaveBeenCalledOnce()
  expect(screen.getByText('Pending').tagName).toBe('SPAN')
  expect(screen.getByText('Pending')).toHaveClass('h-5', 'bg-tone-warning-bg', 'text-tone-warning-fg')
  expect(screen.getByRole('button', { name: 'Suggestion' }).parentElement).toHaveClass('border-dashed')
})

it('preserves TagChip sizes, visuals, labels, and callback values', () => {
  const onClick = vi.fn(), onRemove = vi.fn()
  render(<TagChip tag="topic" size="xs" onClick={onClick} onRemove={onRemove} />)
  const button = screen.getByTitle('topic 태그 대화 보기')
  expect(button.parentElement).toHaveClass('h-5', 'bg-muted/40', 'px-1.5')
  expect(button).toHaveTextContent('#topic')
  fireEvent.click(button)
  fireEvent.click(screen.getByRole('button', { name: 'topic 태그 제거' }))
  expect(onClick).toHaveBeenCalledWith('topic')
  expect(onRemove).toHaveBeenCalledWith('topic')
})

it('preserves deterministic SR tag borders, dots, and monospace labels', () => {
  const tag = 'SR-2026-0002'
  const { container } = render(<TagChip tag={tag} />)
  const chip = container.firstElementChild as HTMLElement
  const expected = document.createElement('span')
  expected.style.borderColor = srTagColor(tag)!
  expected.style.background = srTagColor(tag)!
  expect(chip).toHaveClass('h-6', 'px-2', 'bg-muted/40')
  expect(chip.style.borderColor).toBe(expected.style.borderColor)
  expect((chip.firstElementChild as HTMLElement).style.background).toBe(expected.style.background)
  expect(screen.getByText(tag)).toHaveClass('font-mono')
  expect(screen.queryByText('#')).not.toBeInTheDocument()
})

it('connects Field labels, help, errors, and existing descriptions to its child', () => {
  const { rerender } = render(<Field label="Name" help="Helpful"><input /></Field>)
  let input = screen.getByRole('textbox', { name: 'Name' })
  expect(input).toHaveAttribute('aria-describedby', screen.getByText('Helpful').id)
  rerender(<Field label="Name" help="Helpful" error="Required"><input aria-describedby="extra" /></Field>)
  input = screen.getByRole('textbox', { name: 'Name' })
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input.getAttribute('aria-describedby')?.split(' ')).toEqual(['extra', screen.getByText('Helpful').id, screen.getByRole('alert').id])
})

it('supports checkbox Space, radio arrow keys, and tab keyboard navigation', async () => {
  const user = userEvent.setup()
  render(<><Checkbox aria-label="Check" /><RadioGroup defaultValue="a" aria-label="Choice"><RadioGroupItem value="a" aria-label="A" /><RadioGroupItem value="b" aria-label="B" /></RadioGroup><Tabs defaultValue="a"><TabsList aria-label="Sections"><TabsTrigger value="a">First</TabsTrigger><TabsTrigger value="b">Second</TabsTrigger></TabsList><TabsContent value="a">One</TabsContent><TabsContent value="b">Two</TabsContent></Tabs></>)
  await user.tab()
  await user.keyboard(' ')
  expect(screen.getByRole('checkbox')).toBeChecked()
  await user.tab()
  await user.keyboard('{ArrowRight>}')
  await waitFor(() => expect(screen.getByRole('radio', { name: 'B' })).toBeChecked())
  await user.keyboard('{/ArrowRight}')
  await user.click(screen.getByRole('tab', { name: 'First' }))
  await user.keyboard('{ArrowRight}')
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true'))
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Two')
})

it('portals Popover content and restores focus after Escape', async () => {
  const user = userEvent.setup()
  const { container } = render(<Popover><PopoverTrigger>Open</PopoverTrigger><PopoverContent>Popup</PopoverContent></Popover>)
  await user.click(screen.getByRole('button', { name: 'Open' }))
  expect(container).not.toContainElement(screen.getByText('Popup'))
  await user.keyboard('{Escape}')
  expect(screen.queryByText('Popup')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()
})

it('opens an accessible Sheet with translated close control and returns focus', async () => {
  const user = userEvent.setup()
  render(<Sheet><SheetTrigger>Edit</SheetTrigger><SheetContent side="left"><SheetTitle>Editor</SheetTitle><SheetDescription>Details</SheetDescription></SheetContent></Sheet>)
  await user.click(screen.getByRole('button', { name: 'Edit' }))
  expect(screen.getByRole('dialog', { name: 'Editor' })).toHaveAttribute('data-side', 'left')
  await user.click(screen.getByRole('button', { name: '닫기' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus()
})
