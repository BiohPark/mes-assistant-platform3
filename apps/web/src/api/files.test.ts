import { afterEach, expect, it, vi } from 'vitest'
import { deleteFile, fileVersions, setInput, uploadFile } from './files'

afterEach(() => vi.unstubAllGlobals())

it('uploads bytes as multipart and reads a version chain', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    return new Response(JSON.stringify(url.endsWith('/versions') ? [{ id: 'v2' }, { id: 'v1' }] : { id: 'v2' }), { status: 200 })
  }))
  const file = new File(['two'], '한글.txt', { type: 'text/plain' })
  expect((await uploadFile({ userId: 'u' }, { taskId: 't' }, file)).id).toBe('v2')
  expect(calls[0]![0]).toBe('/api/files')
  expect(calls[0]![1]?.body).toBeInstanceOf(FormData)
  expect((calls[0]![1]!.body as FormData).get('originTaskId')).toBe('t')
  expect((await fileVersions('v2')).map((row) => row.id)).toEqual(['v2', 'v1'])
})

it('reports deletion conflicts and sends explicit input weights', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/files/f' && init?.method === 'DELETE') return new Response(JSON.stringify({ message: '다른 대화에서 입력으로 사용 중' }), { status: 409 })
    return new Response(null, { status: 204 })
  }))
  expect(await deleteFile('f')).toEqual({ ok: false, reason: '다른 대화에서 입력으로 사용 중' })
  await setInput({ userId: 'u' }, 't', 'f', 'main')
  expect(fetch).toHaveBeenCalledWith('/api/tasks/t/inputs/f', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ weight: 'main' }) }))
})
