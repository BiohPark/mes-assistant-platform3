import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AssistantAvatar } from './AssistantAvatar'

it.each([
  ['Quality Analyst', 'QA', 'Q'],
  ['URS Analyst', 'URS', 'U'],
  ['도우미', '도', '도'],
  ['   Quality Analyst   ', 'QA', 'Q'],
  ['', '?', '?'],
] as const)('limits initials only when requested for %s', (name, full, single) => {
  const assistant = { name, color: 'var(--primary)' }
  const { container, rerender } = render(<AssistantAvatar assistant={assistant} size="xs" />)
  expect(container.firstElementChild).toHaveTextContent(full)
  rerender(<AssistantAvatar assistant={assistant} size="xs" singleInitial />)
  expect(container.firstElementChild).toHaveTextContent(single)
  expect(container.firstElementChild?.textContent).toHaveLength(1)
})

it('preserves the image avatar and supplied size classes when limiting initials', () => {
  const { container } = render(<AssistantAvatar assistant={{ name: 'Quality Analyst', color: 'var(--primary)', imageId: 'image/id' }} size="xs" singleInitial className="size-5 ring-2 ring-background" />)
  const avatar = container.firstElementChild!
  expect(avatar).toHaveClass('size-5', 'ring-2', 'ring-background')
  expect(avatar.textContent).toBe('')
  expect(avatar.querySelector('img')).toHaveAttribute('src', '/api/files/image%2Fid/content')
  expect(avatar.querySelector('img')).toHaveAttribute('alt', '')
})
