import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useSort } from '@/lib/useSort'
import { SortHeader } from './SortHeader'

function Table() {
  const { rows, sort, toggle } = useSort([{ name: '나' }, { name: '가' }], { name: (row: { name: string }) => row.name })
  return <table><thead><tr><SortHeader column="name" sort={sort} onToggle={toggle}>이름</SortHeader></tr></thead>
    <tbody>{rows.map(row => <tr key={row.name}><td>{row.name}</td></tr>)}</tbody></table>
}

it('열 머리 버튼이 aria-sort를 바꾸며 행을 정렬한다', () => {
  render(<Table />)
  const header = screen.getByRole('columnheader', { name: '이름' })
  expect(header).not.toHaveAttribute('aria-sort')
  expect(screen.getAllByRole('cell').map(cell => cell.textContent)).toEqual(['나', '가'])
  fireEvent.click(screen.getByRole('button', { name: '이름' }))
  expect(header).toHaveAttribute('aria-sort', 'ascending')
  expect(screen.getAllByRole('cell').map(cell => cell.textContent)).toEqual(['가', '나'])
  fireEvent.click(screen.getByRole('button', { name: '이름' }))
  expect(header).toHaveAttribute('aria-sort', 'descending')
  expect(screen.getAllByRole('cell').map(cell => cell.textContent)).toEqual(['나', '가'])
  fireEvent.click(screen.getByRole('button', { name: '이름' }))
  expect(header).not.toHaveAttribute('aria-sort')
})
