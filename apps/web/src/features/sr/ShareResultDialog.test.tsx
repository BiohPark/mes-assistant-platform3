import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { SrDetail } from '@/api/sr'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { ShareResultDialog } from './ShareResultDialog'

afterEach(() => vi.unstubAllGlobals())
const sr: SrDetail = { id: 'sr', code: 'SR-1', title: '요청', titleSource: 'manual', requesterId: 'u', body: '', status: 'submitted', attachmentIds: [], candidateAttachmentIds: [], threadId: 'thread', results: [], createdAt: '2026-10-01', updatedAt: '2026-10-01', conversations: [] }

it.each([6, 7])('%i개 연결 대화는 칩/검색으로 선택하고 변경 시 이전 파일 선택을 지운다', async count => {
  const conversations = Array.from({ length: count }, (_, i) => ({ id: `task${i}`, code: `WK-${i}`, title: `대화 ${i}`, status: 'in_progress', threadId: `thread${i}` }))
  const bodies: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/service-requests/sr/results') { bodies.push(JSON.parse(String(init?.body))); return jsonResponse(201, {}) }
    if (url.startsWith('/api/tasks/')) return jsonResponse(200, [{ id: 'file', originTaskId: 'task0', name: '산출물.txt', mime: 'text/plain', size: 1, sha256: 'hash', source: 'upload', isOutput: true, version: 1, uploadedBy: 'u', uploadedAt: '2026-10-01' }])
    return jsonResponse(404)
  }))
  const user = userEvent.setup()
  renderWithProviders(<ShareResultDialog sr={{ ...sr, conversations }} open onOpenChange={() => undefined} onSaved={() => undefined} />)
  async function choose(index: number) {
    if (count <= 6) {
      const chip = screen.getByRole('button', { name: `WK-${index} 대화 ${index}` })
      chip.focus(); await user.keyboard('{Enter}')
      expect(chip).toHaveAttribute('aria-pressed', 'true')
    } else {
      const picker = screen.getByRole('combobox', { name: '연결 대화' })
      await user.click(picker); await user.clear(picker); await user.type(picker, `대화 ${index}`)
      await screen.findByRole('option', { name: `WK-${index} 대화 ${index}` })
      expect(picker).toHaveAttribute('aria-expanded', 'true')
      await user.keyboard('{ArrowDown}{Enter}')
    }
  }
  await choose(0)
  await user.click(await screen.findByRole('checkbox', { name: '산출물.txt' }))
  expect(screen.getByRole('checkbox', { name: '산출물.txt' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '산출물.txt' })).toHaveAttribute('data-state', 'checked')
  await choose(1)
  expect(await screen.findByRole('checkbox', { name: '산출물.txt' })).not.toBeChecked()
  await user.type(screen.getByRole('textbox', { name: '공유 내용' }), '공유 내용')
  await user.click(screen.getByRole('button', { name: /^공유$/ }))
  await waitFor(() => expect(bodies).toEqual([{ taskId: 'task1', text: '공유 내용', fileIds: [] }]))
  await user.click(screen.getByRole('button', { name: '대화 선택 안 함' }))
  await user.type(screen.getByRole('textbox', { name: '공유 내용' }), '공유 내용')
  await user.click(screen.getByRole('button', { name: /^공유$/ }))
  await waitFor(() => expect(bodies).toHaveLength(2))
  expect(bodies[1]).toEqual({ text: '공유 내용', fileIds: [] })
})
