import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useTablistKeys } from './useTablistKeys'

const values = ['a', 'b', 'c'] as const
type Value = (typeof values)[number]

function Probe({ orientation }: { orientation?: 'horizontal' | 'vertical' }) {
  const [active, setActive] = useState<Value>('a')
  const { tablistProps, tabProps } = useTablistKeys(values, active, setActive, { orientation })
  return <div role="tablist" aria-label="probe" {...tablistProps}>{values.map(value => <button key={value} type="button" {...tabProps(value)} onClick={() => setActive(value)}>{value}</button>)}</div>
}

function tab(name: string) { return screen.getByRole('tab', { name }) }

it('활성 탭만 tabIndex 0이고 나머지는 -1이다', () => {
  render(<Probe />)
  expect(tab('a')).toHaveAttribute('tabindex', '0')
  expect(tab('a')).toHaveAttribute('aria-selected', 'true')
  expect(tab('b')).toHaveAttribute('tabindex', '-1')
  expect(tab('b')).toHaveAttribute('aria-selected', 'false')
  fireEvent.click(tab('c'))
  expect(tab('c')).toHaveAttribute('tabindex', '0')
  expect(tab('a')).toHaveAttribute('tabindex', '-1')
})

it('←/→는 순환하며 자동 활성화하고 포커스를 옮긴다', () => {
  render(<Probe />)
  tab('a').focus()
  fireEvent.keyDown(tab('a'), { key: 'ArrowRight' })
  expect(tab('b')).toHaveAttribute('aria-selected', 'true')
  expect(tab('b')).toHaveFocus()
  fireEvent.keyDown(tab('b'), { key: 'ArrowLeft' })
  fireEvent.keyDown(tab('a'), { key: 'ArrowLeft' })
  expect(tab('c')).toHaveAttribute('aria-selected', 'true')
  expect(tab('c')).toHaveFocus()
  fireEvent.keyDown(tab('c'), { key: 'ArrowRight' })
  expect(tab('a')).toHaveAttribute('aria-selected', 'true')
  expect(tab('a')).toHaveFocus()
})

it('Home/End는 처음·끝으로 가고 다른 키는 무시한다', () => {
  render(<Probe />)
  tab('a').focus()
  fireEvent.keyDown(tab('a'), { key: 'End' })
  expect(tab('c')).toHaveAttribute('aria-selected', 'true')
  expect(tab('c')).toHaveFocus()
  fireEvent.keyDown(tab('c'), { key: 'Home' })
  expect(tab('a')).toHaveAttribute('aria-selected', 'true')
  expect(tab('a')).toHaveFocus()
  const ignored = fireEvent.keyDown(tab('a'), { key: 'Tab' })
  expect(ignored).toBe(true)
  fireEvent.keyDown(tab('a'), { key: 'ArrowDown' })
  expect(tab('a')).toHaveAttribute('aria-selected', 'true')
})

it('세로 방향은 ↑/↓로 움직이고 ←/→는 무시한다', () => {
  render(<Probe orientation="vertical" />)
  expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical')
  tab('a').focus()
  fireEvent.keyDown(tab('a'), { key: 'ArrowRight' })
  expect(tab('a')).toHaveAttribute('aria-selected', 'true')
  fireEvent.keyDown(tab('a'), { key: 'ArrowDown' })
  expect(tab('b')).toHaveAttribute('aria-selected', 'true')
  expect(tab('b')).toHaveFocus()
  fireEvent.keyDown(tab('b'), { key: 'ArrowUp' })
  expect(tab('a')).toHaveAttribute('aria-selected', 'true')
  expect(tab('a')).toHaveFocus()
})
