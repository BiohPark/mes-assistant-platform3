import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Message, Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { MeContext } from '@/app/auth'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { SaveAsOutputDialog } from './SaveAsOutputDialog'

const success = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { success, error: vi.fn() } }))
afterEach(() => { vi.unstubAllGlobals(); success.mockClear() })

it('offers a materials action after saving that waits for the user before opening materials', async () => {
  const calls: Array<{ url: string; method?: string; body?: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: init?.body })
    if (url === '/api/tasks/t/outputs') return jsonResponse(201, { name: '분석_WK-1.md', version: 1 })
    return jsonResponse(200, [])
  }))
  const onClose = vi.fn()
  const onOpenMaterials = vi.fn()
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><SaveAsOutputDialog
    message={{ content: '분석 결과' } as Message} task={{ id: 't', code: 'WK-1' } as Task} assistant={{ level2: '분석' } as Assistant}
    onClose={onClose} onOpenMaterials={onOpenMaterials} /></MeContext>)
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(success).toHaveBeenCalledWith('산출물로 저장했습니다 (분석_WK-1.md v1).', expect.objectContaining({ action: expect.objectContaining({ label: '자료에서 보기', onClick: expect.any(Function) }) })))
  expect(onClose).toHaveBeenCalledOnce()
  expect(onOpenMaterials).not.toHaveBeenCalled()
  const before = [...calls]
  const action = success.mock.calls[0][1].action
  await act(async () => action.onClick())
  expect(onOpenMaterials).toHaveBeenCalledOnce()
  expect(calls).toEqual(before)
  expect(calls.filter(({ method }) => method === 'POST')).toEqual([{ url: '/api/tasks/t/outputs', method: 'POST', body: JSON.stringify({ name: '분석_WK-1.md', content: '분석 결과' }) }])
  expect(calls.some(({ url }) => /candidates|inputs/.test(url))).toBe(false)
})
