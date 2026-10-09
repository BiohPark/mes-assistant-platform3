import { afterEach, expect, it, vi } from 'vitest'
import { createT } from '@/i18n'
import { deleteFile, downloadBlob, fileVersions, setInput, uploadFile } from './files'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }))
afterEach(() => { vi.unstubAllGlobals(); toastError.mockClear() })

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

const meta = { id: 'f', name: 'report.txt', mime: 'text/plain', size: 1, sha256: 'x', source: 'upload' as const, isOutput: false, version: 1, uploadedBy: 'u', uploadedAt: '2026-01-01T00:00:00.000Z' }

it.each([
  [401, '로그인이 필요합니다'],
  [403, '다운로드 권한이 없습니다'],
  [404, '파일이 없습니다 (삭제됨)'],
  [410, '파일이 없습니다 (삭제됨)'],
])('explains a %i download failure with a toast instead of throwing', async (status, message) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })))
  await expect(downloadBlob(meta, createT('ko'))).resolves.toBeUndefined()
  expect(toastError).toHaveBeenCalledWith(message)
})

it('includes the reason when the download fails on the network', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
  await downloadBlob(meta, createT('ko'))
  expect(toastError).toHaveBeenCalledWith('다운로드하지 못했습니다 (Failed to fetch)')
})

it('triggers the browser download without a toast when the file arrives', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('hello', { status: 200 })))
  const create = vi.fn(() => 'blob:x')
  vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: create, revokeObjectURL: vi.fn() }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  await downloadBlob(meta, createT('ko'))
  expect(create).toHaveBeenCalledTimes(1)
  expect(click).toHaveBeenCalledTimes(1)
  expect(toastError).not.toHaveBeenCalled()
  click.mockRestore()
})
