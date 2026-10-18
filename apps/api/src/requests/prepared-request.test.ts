import { afterEach, expect, it, vi } from 'vitest'
import type { BuiltRequest, LlmPorts } from '@mes/llm'
import type { FileAsset } from '@mes/domain'
import { deliverPreparedRequest } from './prepared-request.js'
import { loadConfig } from '../config/config.js'
import { toLlmSettings } from '../llm/presets.js'

const file = { id: 'file', name: 'captured.txt', version: 1, mime: 'text/plain', size: 8, uploadedBy: 'member', uploadedAt: '', tags: [], source: 'upload', blob: new Blob(['ORIGINAL']) } satisfies FileAsset
function prepared(): BuiltRequest {
  return { settings: { id: 'app', currentUserId: 'member', llm: { ...toLlmSettings(loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' }).llm), mode: 'live', fileDelivery: 'openwebui', baseUrl: 'http://captured.test', apiKey: 'test-key' } },
    model: 'captured-model', messages: [{ role: 'user', content: 'captured content' }], files: [{ type: 'file', id: 'file' }],
    meta: { assistantId: 'a', assistantLevel2: 'A', assistantName: 'Assistant' },
    info: { at: '', provider: 'live', transport: 'openwebui', model: 'captured-model', bytes: 1080, limitBytes: 65536, inputs: [{ kind: 'file', fileId: 'file', name: 'captured.txt', version: 1, weight: 'reference', delivery: 'attached', text: true, bytes: 0 }], srCodes: [], srs: [] }, failed: [] }
}
const ports: Pick<LlmPorts, 'readFileBytes' | 'updateFileRemoteIds'> = { readFileBytes: async () => new Uint8Array(Buffer.from('ORIGINAL')), updateFileRemoteIds: async () => {} }
afterEach(() => vi.unstubAllGlobals())
it('delivers captured file metadata with the frozen settings, preserving the validated content/model/byte count', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    return Response.json(url.endsWith('/process/status') ? { status: 'completed' } : { id: 'remote-file' })
  }))
  const input = prepared()
  const result = await deliverPreparedRequest({ built: input, files: [file] }, ports)
  expect(calls).toEqual(['http://captured.test/api/v1/files/', 'http://captured.test/api/v1/files/remote-file/process/status'])
  expect(result).toMatchObject({ model: 'captured-model', messages: [{ role: 'user', content: 'captured content' }], files: [{ type: 'file', id: 'remote-file' }], info: { bytes: 1080, inputs: [{ remoteId: 'remote-file', delivery: 'attached' }] }, failed: [] })
  expect(input.files).toEqual([{ type: 'file', id: 'file' }])
})
it('records file delivery failures and never substitutes a different prompt', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })))
  const result = await deliverPreparedRequest({ built: prepared(), files: [file] }, ports)
  expect(result.failed).toMatchObject([{ fileId: 'file', delivery: 'failed' }])
  expect(result.files).toEqual([])
  expect(result.messages).toEqual([{ role: 'user', content: 'captured content' }])
})
it('uses the validated inline request without consulting delivery ports', async () => {
  const built = { ...prepared(), files: undefined }
  const result = await deliverPreparedRequest({ built, files: [] }, ports)
  expect(result.model).toBe('captured-model')
  expect(result.info.bytes).toBe(1080)
})
