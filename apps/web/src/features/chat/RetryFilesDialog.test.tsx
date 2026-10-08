import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import type { RequestRecord } from '@/api/requests'
import { renderWithProviders } from '@/test/render'
import { RetryFilesDialog } from './RetryFilesDialog'

const record: RequestRecord = {
  id: 'r', threadId: 't', status: 'failed', provider: 'openwebui', transport: 'http', model: 'model', bytes: 2, limitBytes: 100, hasSnapshot: true,
  inputs: [
    { kind: 'file', weight: 'main', fileId: 'text', sourceLabel: '내용.txt', bytes: 1 },
    { kind: 'file', weight: 'reference', fileId: 'pdf', sourceLabel: '문서.pdf', bytes: 1 },
  ],
}

it.each(['exclude', 'inline'] as const)('%s 파일 Checkbox는 키보드 선택·해제를 반영한 ID만 재시도한다', async mode => {
  const submitted: string[][] = []
  const user = userEvent.setup()
  renderWithProviders(<RetryFilesDialog record={record} mode={mode} onClose={() => undefined} onSubmit={async ids => { submitted.push(ids) }} />)
  const text = screen.getByRole('checkbox', { name: '내용.txt' })
  expect(text).toHaveAttribute('data-slot', 'checkbox')
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeDisabled()
  if (mode === 'inline') expect(screen.queryByRole('checkbox', { name: '문서.pdf' })).not.toBeInTheDocument()
  else await user.click(screen.getByRole('checkbox', { name: '문서.pdf' }))
  text.focus()
  await user.keyboard(' ')
  expect(text).toBeChecked()
  await user.keyboard(' ')
  expect(text).not.toBeChecked()
  await user.keyboard(' ')
  await user.click(screen.getByRole('button', { name: '다시 시도' }))
  await waitFor(() => expect(submitted).toEqual([mode === 'inline' ? ['text'] : ['pdf', 'text']]))
})
