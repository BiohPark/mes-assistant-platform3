import { lazy, type ComponentType } from 'react'

/** 모듈 로드 실패로 자동 새로고침을 이미 한 번 했다는 표식 (탭 단위) */
export const RELOAD_MARK = 'mes-chunk-reloaded'

// Chrome: Failed to fetch dynamically imported module · Firefox: error loading dynamically imported module
// Safari: Importing a module script failed · Vite preload: Unable to preload CSS · webpack 계열: ChunkLoadError
const MODULE_LOAD_PATTERN = /dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (?:CSS )?chunk|ChunkLoadError/i

export function isModuleLoadError(error: unknown): boolean {
  return error instanceof Error && MODULE_LOAD_PATTERN.test(`${error.name} ${error.message}`)
}

/**
 * `lazy()`와 같되, chunk 로드 실패(배포 직후 옛 탭·Vite 캐시)는 sessionStorage 표식으로 **1회만** 자동 새로고침한다.
 * 새로고침 뒤에도 실패하면 오류를 던져 라우트의 errorElement가 받는다. 정상 로드되면 표식을 지운다.
 */
export function lazyPage<M, P extends object>(load: () => Promise<M>, pick: (module: M) => ComponentType<P>) {
  return lazy(() => load().then(
    (module) => { sessionStorage.removeItem(RELOAD_MARK); return { default: pick(module) } },
    (error: unknown) => {
      if (!isModuleLoadError(error) || sessionStorage.getItem(RELOAD_MARK)) throw error
      sessionStorage.setItem(RELOAD_MARK, '1')
      window.location.reload()
      return new Promise<{ default: ComponentType<P> }>(() => {}) // 새로고침될 때까지 Suspense 대기
    },
  ))
}
