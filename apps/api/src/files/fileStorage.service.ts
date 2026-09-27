import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile, access, lstat } from 'node:fs/promises'
import { extname, posix, win32, resolve as nativeResolve, sep as nativeSep } from 'node:path'

const invalidWindows = /[<>:"\\|?*]/
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export function isWindowsReservedName(name: string): boolean {
  return reserved.test(name) || invalidWindows.test(name) || /[. ]$/.test(name) || [...name].some((char) => char.charCodeAt(0) < 32)
}

export function createStorageKey(originalName: string, date = new Date()): string {
  const rawExt = extname(originalName).toLowerCase()
  const ext = /^\.[a-z0-9]{1,16}$/.test(rawExt) ? rawExt : ''
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${ext}`
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** storage_key는 호스트 OS에 무관한 / 구분 상대 키다. */
export class FileStorageService {
  private readonly path: typeof posix | typeof win32
  private readonly root: string

  constructor(root: string, platform: 'native' | 'win32' = 'native') {
    this.path = platform === 'win32' || (platform === 'native' && nativeSep === '\\') ? win32 : posix
    this.root = platform === 'native' && nativeSep !== '\\' ? nativeResolve(root) : this.path.resolve(root)
  }

  resolvePath(key: string): string {
    const parts = key.split('/')
    if (!key || key.startsWith('/') || key.includes('\\') || parts.some((part) => !part || part === '.' || part === '..' || isWindowsReservedName(part))) throw new Error('유효하지 않은 storage_key')
    const path = this.path.resolve(this.root, ...parts)
    const relative = this.path.relative(this.root, path)
    if (!relative || relative === '..' || relative.startsWith(`..${this.path.sep}`) || this.path.isAbsolute(relative)) throw new Error('storage_key가 저장 루트를 벗어났습니다')
    return path
  }

  private async rejectSymlinks(key: string): Promise<void> {
    let current = this.root
    for (const part of key.split('/')) {
      current = this.path.join(current, part)
      try {
        if ((await lstat(current)).isSymbolicLink()) throw new Error('storage_key에 심볼릭 링크를 사용할 수 없습니다')
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
        throw error
      }
    }
  }

  async write(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.resolvePath(key)
    await this.rejectSymlinks(key)
    await mkdir(this.path.dirname(path), { recursive: true })
    await this.rejectSymlinks(key)
    await writeFile(path, bytes)
  }

  async read(key: string): Promise<Uint8Array> {
    const path = this.resolvePath(key)
    await this.rejectSymlinks(key)
    return Uint8Array.from(await readFile(path))
  }
  async exists(key: string): Promise<boolean> {
    const path = this.resolvePath(key)
    await this.rejectSymlinks(key)
    try { await access(path); return true } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
      throw error
    }
  }
  async remove(key: string): Promise<void> {
    const path = this.resolvePath(key)
    await this.rejectSymlinks(key)
    await rm(path, { force: true })
  }
}
