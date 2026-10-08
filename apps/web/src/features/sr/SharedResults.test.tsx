import { screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { SharedResults } from './SharedResults'

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

it('공유 파일 UUID는 링크 주소에서만 사용한다', () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404)))
  const { container } = renderWithProviders(<SharedResults results={[{ id: 'result', text: '', fileIds: ['internal-file-uuid'], by: 'u', at: '2026-10-01' }]} />)
  expect(screen.getByRole('link', { name: '공유 파일 1' })).toHaveAttribute('href', '/api/files/internal-file-uuid/content')
  expect(container).not.toHaveTextContent('internal-file-uuid')
})


it('공유 결과 카드에 파일명·공유자·시각·다운로드를 표시한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { name: '분석 결과.md' })))
  renderWithProviders(<SharedResults results={[{ id: 'r', text: '**처리 완료**', fileIds: ['f'], by: 'user-uuid', byName: '김담당', at: '2026-10-01T09:00:00' }]} />) // 시간대 표기 없는 값은 로컬 시각 — CI(UTC)·KST 모두 같은 표시
  expect(await screen.findByRole('link', { name: '분석 결과.md' })).toHaveAttribute('download')
  expect(screen.getByText('처리 완료', { selector: 'strong' })).toBeInTheDocument()
  expect(screen.getByText('김담당 · 10-01 09:00')).toBeInTheDocument()
})
