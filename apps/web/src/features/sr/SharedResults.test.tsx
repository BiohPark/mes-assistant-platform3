import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { SharedResults } from './SharedResults'

it('공유 파일 UUID는 링크 주소에서만 사용한다', () => {
  const { container } = renderWithProviders(<SharedResults results={[{ id: 'result', text: '', fileIds: ['internal-file-uuid'], by: 'u', at: '2026-10-01' }]} />)
  expect(screen.getByRole('link', { name: '공유 파일 1' })).toHaveAttribute('href', '/api/files/internal-file-uuid/content')
  expect(container).not.toHaveTextContent('internal-file-uuid')
})
