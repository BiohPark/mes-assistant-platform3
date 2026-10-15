import { existsSync } from 'node:fs'
import * as path from 'node:path'

export type ConfigPathOptions = {
  cwd?: string
  execArgv?: readonly string[]
  appRoot?: string
  pathApi?: typeof path.posix
  fileExists?: (file: string) => boolean
}

/** src/config와 dist/config 양쪽에서 동일. 배포 묶음은 apps/api 대신 api를 쓴다. */
const apiRoot = path.resolve(import.meta.dirname, '../..')
const apiParent = path.dirname(apiRoot)
const defaultAppRoot = path.basename(apiParent) === 'apps' ? path.dirname(apiParent) : apiParent

export function configPaths(options: ConfigPathOptions = {}) {
  const pathApi = options.pathApi ?? path
  const cwd = options.cwd ?? process.cwd()
  const appRoot = options.appRoot ?? defaultAppRoot
  const execArgv = options.execArgv ?? process.execArgv
  const fileExists = options.fileExists ?? existsSync
  const envFiles: string[] = []
  // 현재 앱은 코드로 .env를 로드하지 않는다. Node CLI가 실제 읽은 파일만 사용한다.
  // 여러 파일이면 Node의 덮어쓰기 순서대로 마지막으로 읽은 파일을 기준으로 한다.
  for (let i = 0; i < execArgv.length; i++) {
    const arg = execArgv[i]!
    let file: string | undefined
    if (arg === '--env-file' || arg === '--env-file-if-exists') file = execArgv[++i]
    else if (arg.startsWith('--env-file=') || arg.startsWith('--env-file-if-exists=')) file = arg.slice(arg.indexOf('=') + 1)
    if (file) {
      const absolute = pathApi.resolve(cwd, file)
      if (fileExists(absolute)) envFiles.push(absolute)
    }
  }
  const envFile = envFiles.at(-1) ?? null
  const baseDir = envFile ? pathApi.dirname(envFile) : appRoot
  return {
    appRoot, envFiles, envFile, baseDir, pathApi,
    resolve(value: string, setting: string) {
      // D:storage는 Windows의 드라이브별 cwd에 의존하므로 허용하지 않는다.
      if (pathApi.sep === '\\' && /^[a-z]:($|[^\\/])/i.test(value)) {
        throw new Error(`설정 오류 — ${setting}: 드라이브 문자가 있는 경로는 절대 경로여야 합니다`)
      }
      return pathApi.resolve(baseDir, value)
    },
  }
}
