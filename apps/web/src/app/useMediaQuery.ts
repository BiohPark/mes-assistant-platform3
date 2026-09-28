import { useSyncExternalStore } from 'react'

function subscribe(query: string, cb: () => void): () => void {
  const mql = window.matchMedia(query)
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

/** CSS 미디어쿼리 매칭 여부. SSR 없음 → 초기값도 실제 매칭값 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => subscribe(query, cb),
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Tailwind lg 브레이크포인트 */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)')
}
