import { afterEach, expect, it, vi } from 'vitest'
import { listSrInputs, removeSrInput, selectSrInput } from './srInputs'
import { queryClient } from './queryClient'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('loads SR staging and invalidates the estimate after selection/removal with encoded IDs', async () => {
  const item = { srId: 'sr/1', code: 'SR-2026-0001', title: '요청', body: '본문', bytes: 6, selected: false, used: true }
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'GET'
    ? new Response(JSON.stringify([item])) : new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
  expect(await listSrInputs('task/1')).toEqual([item])
  expect(invalidate).not.toHaveBeenCalled()
  await selectSrInput('task/1', 'sr/1')
  await removeSrInput('task/1', 'sr/1')
  expect(fetch.mock.calls).toEqual([
    ['/api/tasks/task%2F1/sr-inputs', { method: 'GET', credentials: 'same-origin' }],
    ['/api/tasks/task%2F1/sr-inputs/sr%2F1', { method: 'PUT', credentials: 'same-origin' }],
    ['/api/tasks/task%2F1/sr-inputs/sr%2F1', { method: 'DELETE', credentials: 'same-origin' }],
  ])
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sr-inputs', 'task/1'] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['estimate'], refetchType: 'none' })
})

it('preserves server access failures without invalidating successful state', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: '접근 가능한 연결 SR이 아닙니다' }), { status: 404 })))
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
  await expect(selectSrInput('task', 'sr')).rejects.toThrow('접근 가능한 연결 SR이 아닙니다')
  expect(invalidate).not.toHaveBeenCalled()
})
