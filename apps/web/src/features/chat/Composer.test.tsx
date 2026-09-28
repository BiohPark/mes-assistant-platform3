import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { Composer } from './Composer'

it('sends text as discussion while AI and file controls are unavailable', async () => {
  const send = vi.fn(async () => undefined)
  render(<Composer streaming={false} onSend={send} onStop={() => undefined} allowAttachments={false} />)
  expect(screen.queryByRole('button', { name: '파일 첨부' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '팀 의견 (AI 미전송)' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByPlaceholderText('팀 의견을 남기세요 (AI에게 전송되지 않음)'), { target: { value: '안녕하세요' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('안녕하세요', [], true))
})
