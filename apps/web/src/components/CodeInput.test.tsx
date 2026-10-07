import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import type { Assistant, CatalogCode } from '@mes/contracts'
import { I18nProvider } from '@/i18n'
import { CodeInput } from './CodeInput'

const codes: CatalogCode[] = [
  { id: 'a', groupKey: 'assistant_level2', code: 'A', name: '많이 사용', active: true, sortOrder: 1, isAuto: false },
  { id: 'b', groupKey: 'assistant_level2', code: 'B', name: '함께 사용', active: true, sortOrder: 2, isAuto: true },
  { id: 'c', groupKey: 'assistant_level2', code: 'C', name: '비활성', active: false, sortOrder: 3, isAuto: false },
  { id: 'd', groupKey: 'assistant_level1', code: 'D', name: '다른 그룹', active: true, sortOrder: 4, isAuto: false },
]
const assistants = [
  { level1: '선택 분류', level1CodeId: 'l1', level2CodeId: 'b' },
  { level1: '다른 분류', level1CodeId: 'l2', level2CodeId: 'a' },
  { level1: '다른 분류', level1CodeId: 'l2', level2CodeId: 'a' },
] as Assistant[]
function Example({ level1 = '', initial = '' }) {
  const [value, onChange] = useState(initial)
  return <><CodeInput group="assistant_level2" codes={codes} assistants={assistants} level1={level1} value={value} onChange={onChange} aria-label="분류 2" /><output data-testid="value">{value}</output></>
}
it('사용 수 순으로 추천하고 분류 1과 함께 쓴 분류 2를 우선한다', async () => {
  const { rerender } = render(<Example />)
  fireEvent.focus(screen.getByRole('combobox'))
  expect((await screen.findAllByRole('option')).map(row => row.textContent)).toEqual(['많이 사용사용 2', '함께 사용사용 1'])
  rerender(<Example level1=" 선택   분류 " />)
  await waitFor(() => expect(screen.getAllByRole('option').map(row => row.textContent)).toEqual(['함께 사용사용 1', '많이 사용사용 2']))
  expect(screen.queryByRole('option', { name: /비활성|다른 그룹/ })).not.toBeInTheDocument()
})
it('생성한 이름은 공백·NFC를 정규화하며 선택·재편집·제거할 수 있다', async () => {
  render(<Example />)
  const input = screen.getByRole('combobox')
  fireEvent.change(input, { target: { value: '  Cafe\u0301   새 분류 ' } })
  await screen.findByRole('option', { name: '새로 추가: Café 새 분류' })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByTestId('value')).toHaveTextContent('Café 새 분류')
  fireEvent.click(screen.getByRole('button', { name: 'Café 새 분류 수정' }))
  fireEvent.change(input, { target: { value: '많이 사용' } })
  await screen.findByRole('option', { name: '많이 사용사용 2' })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByTestId('value')).toHaveTextContent('많이 사용')
  fireEvent.click(screen.getByRole('button', { name: '많이 사용 제거' }))
  expect(screen.getByTestId('value')).toBeEmptyDOMElement()
})
it('영어로 추천 사용 수와 분류 이름을 표시한다', async () => {
  render(<I18nProvider locale="en"><Example /></I18nProvider>)
  fireEvent.focus(screen.getByRole('combobox'))
  expect(await screen.findByRole('option', { name: '많이 사용Used 2' })).toBeInTheDocument()
})
