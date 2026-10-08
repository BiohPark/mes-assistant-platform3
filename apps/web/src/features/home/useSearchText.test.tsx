import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, useNavigate, useSearchParams } from 'react-router'
import { expect, it } from 'vitest'
import { useSearchText } from './useSearchText'

function Search({ replace }: { replace: boolean }) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  // Publication is held until acknowledgement, as with a pending router loader.
  const [submitted, setSubmitted] = useState('프로토콜')
  const search = useSearchText(params.get('q') ?? '', setSubmitted)
  return <>
    <input aria-label="Search" {...search} />
    <button onClick={() => setParams({ q: '프로토콜', tag: 'keep' }, { replace })}>Unrelated navigation</button>
    <button onClick={() => setParams(submitted ? { q: submitted, tag: 'keep' } : { tag: 'keep' })}>Acknowledge</button>
    <button onClick={() => void navigate(-1)}>Back</button>
    <output data-testid="search-url">{params.toString()}</output>
  </>
}

it.each([true, false])('preserves a pending local clear when an unchanged URL query arrives in the same render (replace=%s)', replace => {
  render(<MemoryRouter initialEntries={['/?q=프로토콜']}><Search replace={replace} /></MemoryRouter>)
  const input = screen.getByRole('textbox', { name: 'Search' })
  // Commit an older navigation alongside the newer edit, without relying on machine speed.
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Unrelated navigation' }))
    fireEvent.change(input, { target: { value: '' } })
  })
  expect(input).toHaveValue('')
  expect(screen.getByTestId('search-url')).toHaveTextContent('q=%ED%94%84%EB%A1%9C%ED%86%A0%EC%BD%9C')
  fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }))
  expect(input).toHaveValue('')
  expect(screen.getByTestId('search-url')).toHaveTextContent('tag=keep')
  expect(screen.getByTestId('search-url')).not.toHaveTextContent('q=')
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(input).toHaveValue('프로토콜')
})

it('lets history cancel a pending edit even when the URL query is unchanged', () => {
  render(<MemoryRouter initialEntries={['/?q=프로토콜', '/?q=프로토콜&tag=keep']}><Search replace={false} /></MemoryRouter>)
  const input = screen.getByRole('textbox', { name: 'Search' })
  fireEvent.change(input, { target: { value: '' } })
  expect(input).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(input).toHaveValue('프로토콜')
  expect(screen.getByTestId('search-url')).not.toHaveTextContent('tag=')
})
