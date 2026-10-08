import { useState } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { ModelSelect } from './ModelSelect'

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <><ModelSelect value={value} onChange={setValue} aria-label="모델" /><output aria-label="선택값">{value}</output></>
}
afterEach(() => vi.unstubAllGlobals())

describe('ModelSelect', () => {
  it('목록을 불러와 입력으로 거르고 선택하면 값이 바뀐다 — 셰브론은 목록을 토글한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { models: ['fake-general', 'fake-writer', 'other'] })))
    renderWithProviders(<Harness />)
    const input = screen.getByRole('combobox', { name: '모델' })
    fireEvent.focus(input)
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['fake-general', 'fake-writer', 'other'])
    expect(input).toHaveAttribute('aria-expanded', 'true')
    fireEvent.change(input, { target: { value: 'fake' } })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    expect(screen.getByLabelText('선택값')).toHaveTextContent('fake')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByLabelText('선택값')).toHaveTextContent('fake-writer')
    expect(input).toHaveValue('fake-writer')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    fireEvent.mouseDown(screen.getByRole('button', { name: '모델 목록 열기' }))
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getAllByRole('option')[0]!)
    expect(screen.getByLabelText('선택값')).toHaveTextContent('fake-general')
  })

  it('불러오는 동안 상태를 알리고, 실패하면 재시도와 직접 입력을 안내한다', async () => {
    let finish!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<Harness />)
    const input = screen.getByRole('combobox', { name: '모델' })
    fireEvent.focus(input)
    expect(await screen.findByText('모델 목록을 불러오는 중…')).toBeInTheDocument()
    finish(jsonResponse(502, { message: '모델 목록 조회 실패' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('모델 목록을 불러오지 못했습니다. 직접 입력할 수 있습니다.')
    fireEvent.change(input, { target: { value: 'typed-model' } })
    expect(screen.getByLabelText('선택값')).toHaveTextContent('typed-model')
    fireEvent.mouseDown(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('빈 목록은 비어 있음을 알린다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { models: [] })))
    renderWithProviders(<Harness />)
    fireEvent.focus(screen.getByRole('combobox', { name: '모델' }))
    expect(await screen.findByText('모델이 없습니다. 직접 입력할 수 있습니다.')).toBeInTheDocument()
  })
})
