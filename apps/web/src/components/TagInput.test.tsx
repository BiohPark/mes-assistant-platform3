import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { rankTagSuggestions, type TagSuggestion } from '@mes/domain'
import { MeContext } from '@/app/auth'
import { TagInput } from './TagInput'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))
afterEach(() => toastError.mockClear())

const me = { id: 'u', name: '사용자', role: '', roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }
const pool: TagSuggestion[] = [
  { tag: 'CC-2099-0010', count: 3, isSr: false },
  { tag: 'SR-2026-0001', count: 1, isSr: true, srStatus: 'accepted' },
  { tag: 'SR-2026-0002', count: 1, isSr: true, srStatus: 'unfiled' },
  { tag: 'SR-2026-0005', count: 1, isSr: true, srStatus: 'unknown' },
]
const suggest = (prefix: string) => rankTagSuggestions(pool, prefix)
type Props = Partial<Parameters<typeof TagInput>[0]>

function mount(props: Props = {}) {
  const onAdd = props.onAdd ?? vi.fn(async () => undefined)
  const tree = (next: Props) => <MeContext value={me}><TagInput tags={[]} onRemove={() => undefined} suggest={suggest} {...props} {...next} onAdd={onAdd} /></MeContext>
  const view = render(tree({}))
  return { onAdd, input: screen.getByRole('combobox', { name: '태그 입력' }), rerender: (next: Props) => view.rerender(tree(next)) }
}
const saved = (input: HTMLElement) => waitFor(() => expect(input).toHaveAttribute('aria-busy', 'false'))

it('Enter without choosing a candidate commits the typed value, not the most-used prefix candidate', () => {
  const { onAdd, input } = mount()
  fireEvent.change(input, { target: { value: 'CC-2099-001' } })
  expect(screen.getByRole('option', { name: /CC-2099-0010/ })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: /CC-2099-0010/ })).toHaveAttribute('aria-selected', 'false')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onAdd).toHaveBeenCalledWith('CC-2099-001')
  expect(onAdd).toHaveBeenCalledTimes(1)
})

it('ArrowDown then Enter commits the highlighted candidate; clicking a candidate commits it', async () => {
  const { onAdd, input } = mount()
  fireEvent.change(input, { target: { value: 'CC-2099-00' } })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  expect(screen.getByRole('option', { name: /CC-2099-0010/ })).toHaveAttribute('aria-selected', 'true')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onAdd).toHaveBeenLastCalledWith('CC-2099-0010')
  await saved(input)
  fireEvent.change(input, { target: { value: 'CC' } })
  fireEvent.mouseDown(screen.getByRole('option', { name: /CC-2099-0010/ }))
  expect(onAdd).toHaveBeenLastCalledWith('CC-2099-0010')
  expect(onAdd).toHaveBeenCalledTimes(2)
})

it('keeps the chosen candidate by tag when suggestions reorder, and drops the choice when it disappears', async () => {
  const a = { tag: 'CC-2099-0010', count: 3, isSr: false }
  const b = { tag: 'CC-2099-0011', count: 2, isSr: false }
  const { onAdd, input, rerender } = mount({ suggest: (prefix) => rankTagSuggestions([a, b], prefix) })
  fireEvent.change(input, { target: { value: 'CC-2099-00' } })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  expect(screen.getByRole('option', { name: /CC-2099-0011/ })).toHaveAttribute('aria-selected', 'true')
  // 추천이 재정렬돼 0011이 첫 줄로 — 고른 것은 여전히 0011
  rerender({ suggest: (prefix) => rankTagSuggestions([{ ...b, count: 9 }, a], prefix) })
  expect(screen.getAllByRole('option')[0]).toHaveTextContent('CC-2099-0011')
  expect(screen.getByRole('option', { name: /CC-2099-0011/ })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('option', { name: /CC-2099-0010/ })).toHaveAttribute('aria-selected', 'false')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onAdd).toHaveBeenLastCalledWith('CC-2099-0011')
  await saved(input)
  // 고른 후보가 목록에서 사라지면 선택이 풀리고 Enter는 입력값 그대로
  fireEvent.change(input, { target: { value: 'CC-2099-00' } })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  expect(screen.getByRole('option', { name: /CC-2099-0011/ })).toHaveAttribute('aria-selected', 'true')
  rerender({ suggest: (prefix) => rankTagSuggestions([a], prefix) })
  expect(screen.queryByRole('option', { selected: true })).not.toBeInTheDocument()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onAdd).toHaveBeenLastCalledWith('CC-2099-00')
})

it('comma and Tab commit the typed value as-is', async () => {
  const { onAdd, input } = mount()
  fireEvent.change(input, { target: { value: 'release-10' } })
  fireEvent.keyDown(input, { key: ',' })
  expect(onAdd).toHaveBeenLastCalledWith('release-10')
  await saved(input)
  fireEvent.change(input, { target: { value: 'cc-item' } })
  fireEvent.keyDown(input, { key: 'Tab' })
  expect(onAdd).toHaveBeenLastCalledWith('cc-item')
})

it('restores the input and shows a toast when saving fails, and ignores a second submit while saving', async () => {
  let reject!: (error: Error) => void
  const onAdd = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail }))
  const { input } = mount({ onAdd })
  fireEvent.change(input, { target: { value: 'first' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onAdd).toHaveBeenCalledTimes(1)
  expect(input).toHaveValue('')
  expect(input).toHaveAttribute('aria-busy', 'true')
  fireEvent.change(input, { target: { value: 'second' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onAdd).toHaveBeenCalledTimes(1)
  reject(new Error('저장 실패'))
  await waitFor(() => expect(toastError).toHaveBeenCalledWith('저장 실패'))
  // 저장 중 새로 입력한 글자가 있으면 그것을 지키고, 없으면 실패한 입력을 되살린다
  expect(input).toHaveValue('second')
  expect(input).toHaveAttribute('aria-busy', 'false')
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.change(input, { target: { value: 'third' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  reject(new Error('다시 실패'))
  await waitFor(() => expect(input).toHaveValue('third'))
})

it('tells apart accepted, unfiled and not-visible SR tags in chips and in the candidate list', () => {
  const status = (tag: string) => tag === 'SR-2026-0001' ? 'accepted' : tag === 'SR-2026-0003' ? 'unfiled' : 'unknown'
  const { input } = mount({ tags: ['SR-2026-0001', 'SR-2026-0003', 'SR-2026-0004', 'plain'], srStatus: status })
  expect(screen.getAllByText('SR 미접수')).toHaveLength(1)
  expect(screen.getByText('SR 미접수').closest('[data-slot="chip"]')).toHaveTextContent('SR-2026-0003')
  expect(screen.getAllByText('SR 확인 불가')).toHaveLength(1)
  expect(screen.getByText('SR 확인 불가').closest('[data-slot="chip"]')).toHaveTextContent('SR-2026-0004')
  fireEvent.change(input, { target: { value: 'SR-2026-000' } })
  expect(screen.getByRole('option', { name: /SR-2026-0001/ })).toHaveTextContent('SR · 1')
  expect(screen.getByRole('option', { name: /SR-2026-0002/ })).toHaveTextContent('SR 미접수 · 1')
  expect(screen.getByRole('option', { name: /SR-2026-0005/ })).toHaveTextContent('SR 확인 불가 · 1')
})
