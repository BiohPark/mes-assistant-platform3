import { randomUUID } from 'node:crypto'
import type { ResponseImage, ResponseImageFailure } from '@mes/llm'
import { createStorageKey, sha256, type FileStorageService } from './fileStorage.service.js'

export interface PreparedImage { id: string; storageKey: string; originalName: string; mime: string; sizeBytes: number; sha256: string }
/** 파일 바이트를 먼저 준비한다. 메타데이터는 요청 완료 트랜잭션에서 본문과 함께 등록한다. */
export async function prepareResponseImages(storage: FileStorageService, images: ResponseImage[], maxBytes: number) {
  const files: PreparedImage[] = [], replacements = new Map<string, string>(), failures: ResponseImageFailure[] = []
  for (const image of images) {
    if (image.bytes.byteLength > maxBytes) { failures.push({ source: image.sources[0]!, reason: '이미지 크기 한도 초과' }); continue }
    const id = randomUUID()
    const originalName = `${id}-${image.name}`
    const storageKey = createStorageKey(originalName)
    try {
      await storage.write(storageKey, image.bytes)
      files.push({ id, storageKey, originalName, mime: image.mime, sizeBytes: image.bytes.byteLength, sha256: sha256(image.bytes) })
      for (const source of image.sources) replacements.set(source, `/api/files/${id}/content`)
    } catch {
      await storage.remove(storageKey).catch(() => undefined)
      failures.push({ source: image.sources[0]!, reason: '이미지 저장 실패' })
    }
  }
  return { files, replacements, failures }
}
