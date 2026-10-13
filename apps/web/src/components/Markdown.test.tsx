import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Markdown } from './Markdown'

it.each(['primary', 'warning', 'card'] as const)('renders rich Markdown with the %s background tone', (tone) => {
  const { container } = render(<Markdown tone={tone} className="custom-markdown" content={'[문서](https://example.com/docs)\n\nhttps://example.com\n\n`inline`\n\n```ts\nconst value = 1\n```\n\n> 인용\n\n| 항목 | 값 |\n| --- | --- |\n| 링크 | 내용 |'} />)
  expect(container.firstElementChild).toHaveAttribute('data-tone', tone)
  expect(container.firstElementChild).toHaveClass('md-body', 'custom-markdown')
  for (const link of screen.getAllByRole('link')) {
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  }
  expect(screen.getByRole('link', { name: '문서' })).toHaveAttribute('href', 'https://example.com/docs')
  expect(screen.getByRole('link', { name: 'https://example.com' })).toHaveAttribute('href', 'https://example.com')
  expect(container.querySelector('code')).toHaveTextContent('inline')
  expect(container.querySelector('pre code')).toHaveTextContent('const value = 1')
  expect(container.querySelector('blockquote')).toHaveTextContent('인용')
  expect(screen.getByRole('table')).toBeInTheDocument()
})

it('keeps untoned Markdown available outside message bubbles', () => {
  const { container } = render(<Markdown content="본문" />)
  expect(container.firstElementChild).toHaveClass('md-body')
  expect(container.firstElementChild).not.toHaveAttribute('data-tone')
})
