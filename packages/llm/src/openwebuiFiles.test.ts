// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db, ports } from './__tests__/memory.js'
import { deliverFiles as deliverFilesWithPorts, remoteKey, usesFilesApi, versionedName } from './openwebuiFiles.js'
import type { FileAsset, LlmSettings } from '@mes/domain'

const deliverFiles = (settings: LlmSettings, files: FileAsset[], opts: import('./openwebuiFiles.js').DeliverOptions) =>
  deliverFilesWithPorts(settings, files, opts, ports)

const settings: LlmSettings = { mode: 'live', baseUrl: 'http://owui.test/api', apiKey: 'k', model: 'm', fileDelivery: 'openwebui' }
const asset = (id: string, version = 1): FileAsset => ({
  id,
  name: `${id}.md`,
  mime: 'text/markdown',
  size: 3,
  blob: new Blob(['abc'], { type: 'text/markdown' }),
  uploadedBy: 'u',
  uploadedAt: '',
  source: 'upload',
  tags: [],
  version,
})

interface FakeOptions {
  upload?: (n: number) => Response
  status?: (id: string, n: number) => Response
}

/** POST /api/v1/files/ 와 GET /api/v1/files/{id}/process/status 를 흉내낸다 */
function fakeServer(opts: FakeOptions = {}) {
  let uploads = 0
  const polls = new Map<string, number>()
  const names: string[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    if (url.endsWith('/api/v1/files/')) {
      uploads++
      const file = (init!.body as FormData).get('file') as File
      names.push(file.name)
      return opts.upload?.(uploads) ?? new Response(JSON.stringify({ id: `remote-${uploads}` }), { status: 200 })
    }
    const m = /files\/([^/]+)\/process\/status$/.exec(url)
    if (m) {
      const n = (polls.get(m[1]) ?? 0) + 1
      polls.set(m[1], n)
      return opts.status?.(m[1], n) ?? new Response(JSON.stringify({ status: n < 2 ? 'pending' : 'completed' }), { status: 200 })
    }
    return new Response('?', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, polls, names, uploads: () => uploads }
}

beforeEach(async () => {
  await db.files.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usesFilesApi', () => {
  it('only in live mode with openwebui delivery', () => {
    expect(usesFilesApi(settings)).toBe(true)
    expect(usesFilesApi({ ...settings, mode: 'mock' })).toBe(false)
    expect(usesFilesApi({ ...settings, fileDelivery: 'inline' })).toBe(false)
    expect(usesFilesApi({ ...settings, fileDelivery: undefined })).toBe(false)
  })
})

describe('versionedName', () => {
  it('inserts the version before the extension', () => {
    expect(versionedName('URS.md', 2)).toBe('URS (v2).md')
    expect(versionedName('README', 1)).toBe('README (v1)')
    expect(versionedName('a.b.txt', 3)).toBe('a.b (v3).txt')
  })
})

describe('remoteKey', () => {
  it('scopes the cache by server and key without storing the key itself', () => {
    const k1 = remoteKey(settings)
    expect(k1).not.toContain('k#')
    expect(k1.startsWith('http://owui.test#')).toBe(true)
    expect(remoteKey({ ...settings, apiKey: 'other' })).not.toBe(k1)
  })
})

describe('deliverFiles', () => {
  it('uploads with a versioned name and the key, waits until processed, caches and reuses', async () => {
    const f = asset('f1', 2)
    await db.files.add(f)
    const srv = fakeServer()
    const first = await deliverFiles(settings, [f], { pollMs: 1 })
    expect(first.attached.get('f1')).toEqual({ type: 'file', id: 'remote-1' })
    expect(srv.names).toEqual(['f1 (v2).md'])
    expect(srv.polls.get('remote-1')).toBe(2)
    const [url, init] = srv.fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://owui.test/api/v1/files/')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k')

    const stored = (await db.files.get('f1'))!
    expect(stored.remoteIds?.[remoteKey(settings)]).toBe('remote-1')
    await deliverFiles(settings, [stored], { pollMs: 1 })
    expect(srv.uploads()).toBe(1)
  })

  it('treats a missing status endpoint (404) as processed', async () => {
    const f = asset('f404')
    await db.files.add(f)
    fakeServer({ status: () => new Response('not found', { status: 404 }) })
    const r = await deliverFiles(settings, [f], { pollMs: 1 })
    expect(r.attached.has('f404')).toBe(true)
  })

  it('reports processing failures without caching', async () => {
    const f = asset('fp')
    await db.files.add(f)
    fakeServer({ status: () => new Response(JSON.stringify({ status: 'failed' }), { status: 200 }) })
    const r = await deliverFiles(settings, [f], { pollMs: 1 })
    expect(r.attached.size).toBe(0)
    expect(r.failed[0].reason).toMatch(/처리 실패/)
    expect((await db.files.get('fp'))!.remoteIds).toBeUndefined()
  })

  it('reports upload failures', async () => {
    const f = asset('f2')
    await db.files.add(f)
    fakeServer({ upload: () => new Response('nope', { status: 500 }) })
    const r = await deliverFiles(settings, [f], { pollMs: 1 })
    expect(r.attached.size).toBe(0)
    expect(r.failed).toEqual([{ file: f, reason: '업로드 실패 (HTTP 500)' }])
  })

  it('times out a file that never finishes processing', async () => {
    const f = asset('slow')
    await db.files.add(f)
    fakeServer({ status: () => new Response(JSON.stringify({ status: 'pending' }), { status: 200 }) })
    const r = await deliverFiles(settings, [f], { pollMs: 1, processTimeoutMs: 20 })
    expect(r.failed[0].reason).toMatch(/시간 초과/)
  })

  it('aborting stops the whole delivery instead of reporting a file failure', async () => {
    const f = asset('fa')
    await db.files.add(f)
    fakeServer({ status: () => new Response(JSON.stringify({ status: 'pending' }), { status: 200 }) })
    const controller = new AbortController()
    const run = deliverFiles(settings, [f], { pollMs: 5, signal: controller.signal })
    setTimeout(() => controller.abort(), 15)
    await expect(run).rejects.toThrow()
  })
})
