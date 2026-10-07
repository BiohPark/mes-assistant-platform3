import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AssistantPicker } from './AssistantPicker'
import { PersonPicker } from './PersonPicker'

it('PersonPicker recommends self then recent people, deduplicates, and disallows creation', async () => {
  const source = () => [{ value: 'me', label: 'Me' }, { value: 'r', label: 'Recent' }]
  const onChange = vi.fn()
  render(<PersonPicker mode="single" value={null} onChange={onChange} source={source} me={{ value: 'me', label: 'Me' }} recent={[{ value: 'me', label: 'Me' }, { value: 'r', label: 'Recent' }]} />)
  expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Me나', 'Recent최근'])
  fireEvent.click(screen.getByRole('button', { name: 'Me' }))
  expect(onChange).toHaveBeenCalledWith({ value: 'me', label: 'Me' })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Unknown' } })
  await screen.findByText('검색 결과가 없습니다')
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
  expect(screen.getByRole('alert')).toHaveTextContent('목록에서 사람을 선택하세요')
  expect(onChange).toHaveBeenCalledTimes(1)
})

it('AssistantPicker excludes retired assistants from async results and quick picks', async () => {
  const assistants = [{ value: 'a', label: 'Active', status: 'open' as const }, { value: 'r', label: 'Retired', status: 'retired' as const }]
  const onChange = vi.fn()
  render(<AssistantPicker mode="single" value={null} onChange={onChange} source={async () => assistants} quickPicks={assistants} />)
  expect(screen.queryByRole('button', { name: 'Retired' })).not.toBeInTheDocument()
  fireEvent.focus(screen.getByRole('combobox'))
  expect(await screen.findByRole('option')).toHaveTextContent('Active')
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Retired' } })
  await screen.findByText('검색 결과가 없습니다')
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
  expect(screen.getByRole('alert')).toHaveTextContent('목록에서 에이전트를 선택하세요')
  expect(onChange).not.toHaveBeenCalled()
})
