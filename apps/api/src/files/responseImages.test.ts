import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { rewriteResponseImageUrls } from '@mes/llm'
import { FileStorageService } from './fileStorage.service.js'
import { prepareResponseImages } from './responseImages.js'

it('stores image bytes durably and replaces only image destinations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'response-images-'))
  try {
    const storage = new FileStorageService(root)
    const source = '/cache/a(1).png'
    const result = await prepareResponseImages(storage, [{ sources: [source], name: 'a.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }], 100)
    expect(result.files).toHaveLength(1)
    const file = result.files[0]!
    expect(await new FileStorageService(root).read(file.storageKey)).toEqual(new Uint8Array([1, 2, 3]))
    const text = `![a](${source} "title") plain ${source} [link](${source})\n\`![code](${source})\``
    expect(rewriteResponseImageUrls(text, result.replacements)).toBe(`![a](/api/files/${file.id}/content "title") plain ${source} [link](${source})\n\`![code](${source})\``)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('keeps failed image URLs and records storage failures while preserving successful images', async () => {
  const root = await mkdtemp(join(tmpdir(), 'response-images-'))
  try {
    const storage = new FileStorageService(root)
    vi.spyOn(storage, 'write').mockRejectedValueOnce(new Error('disk full'))
    const images = ['bad', 'good'].map(name => ({ sources: [`/cache/${name}.png`], name: `${name}.png`, mime: 'image/png', bytes: new Uint8Array([1]) }))
    const result = await prepareResponseImages(storage, images, 100)
    expect(result.files).toHaveLength(1)
    expect(result.failures).toEqual([{ source: '/cache/bad.png', reason: '이미지 저장 실패' }])
    expect(rewriteResponseImageUrls('![bad](/cache/bad.png)', result.replacements)).toBe('![bad](/cache/bad.png)')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('does not truncate oversized images', async () => {
  const root = await mkdtemp(join(tmpdir(), 'response-images-'))
  try {
    const result = await prepareResponseImages(new FileStorageService(root), [{ sources: ['/cache/large.png'], name: 'large.png', mime: 'image/png', bytes: new Uint8Array([1, 2]) }], 1)
    expect(result.files).toEqual([])
    expect(result.failures).toEqual([{ source: '/cache/large.png', reason: '이미지 크기 한도 초과' }])
  } finally { await rm(root, { recursive: true, force: true }) }
})
