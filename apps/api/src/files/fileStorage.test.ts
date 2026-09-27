import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileStorageService, createStorageKey, isWindowsReservedName, sha256 } from './fileStorage.service.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('FileStorageService', () => {
  it('날짜와 UUID 기반 상대 키를 만들며 원본명은 포함하지 않는다', () => {
    const key = createStorageKey('CON.txt', new Date('2026-09-28T01:00:00Z'))
    expect(key).toMatch(/^2026\/09\/[0-9a-f-]{36}\.txt$/)
    expect(key).not.toContain('CON')
    expect(isWindowsReservedName('CON.txt')).toBe(true)
    expect(isWindowsReservedName('LPT9')).toBe(true)
    expect(isWindowsReservedName('safe.txt')).toBe(false)
  })
  it('상위 경로·역슬래시·절대 키를 거부하고 Windows 루트에서도 탈출을 막는다', () => {
    const store = new FileStorageService('/tmp/storage')
    for (const key of ['../evil', '/evil', 'a/../evil', 'a\\evil', 'C:/evil', 'CON', 'file.']) expect(() => store.resolvePath(key)).toThrow()
    const windows = new FileStorageService('\\\\server\\share\\storage', 'win32')
    expect(windows.resolvePath('2026/09/a.txt')).toBe('\\\\server\\share\\storage\\2026\\09\\a.txt')
    expect(() => windows.resolvePath('../evil')).toThrow()
    expect(new FileStorageService('C:\\', 'win32').resolvePath('2026/09/a.txt')).toBe('C:\\2026\\09\\a.txt')
  })
  it('중간 디렉터리를 생성하고 바이트를 왕복한다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mes-files-'))
    roots.push(root)
    const store = new FileStorageService(root)
    const bytes = new TextEncoder().encode('hello')
    await store.write('2026/09/test.txt', bytes)
    expect(await store.exists('2026/09/test.txt')).toBe(true)
    expect(await store.read('2026/09/test.txt')).toEqual(bytes)
    expect(sha256(bytes)).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    await store.remove('2026/09/test.txt')
    expect(await store.exists('2026/09/test.txt')).toBe(false)
  })
  it.skipIf(process.platform === 'win32')('루트 안 심볼릭 링크를 통한 탈출을 거부한다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mes-files-'))
    const outside = await mkdtemp(join(tmpdir(), 'mes-outside-'))
    roots.push(root, outside)
    await symlink(outside, join(root, 'link'))
    const store = new FileStorageService(root)
    await expect(store.write('link/escape.txt', new Uint8Array([1]))).rejects.toThrow(/심볼릭 링크/)
  })
})
