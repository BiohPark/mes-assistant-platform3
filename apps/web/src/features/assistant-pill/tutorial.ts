import type { PageRoute } from './pageActions'

export type TutorialState = 'asked' | 'accepted' | 'skipped'
/** 사용자·페이지별 가이드 제안 상태 — 한 번 보이면(asked) 다시 묻지 않는다 */
export const guideOfferKey = (userId: string, route: PageRoute) => `tutorial:${userId}:${route}:v1`

// Memory survives remounts when storage is blocked or full, and is scoped to this page session.
const sessionStates = new Map<string, TutorialState>()
export const TUTORIAL_REPLAY = 'assistant-tutorial-replay'

function write(key: string, state: TutorialState) {
  sessionStates.set(key, state)
  try { localStorage.setItem(key, state) } catch {
    try { sessionStorage.setItem(key, state) } catch { /* Memory fallback already recorded. */ }
  }
}

function read(key: string): TutorialState | null {
  const from = (storage: () => Storage): TutorialState | null => {
    try {
      const stored = storage().getItem(key)
      return stored === 'asked' || stored === 'accepted' || stored === 'skipped' ? stored : null
    } catch { return null }
  }
  return from(() => localStorage) ?? from(() => sessionStorage)
}

export function saveGuideOffer(userId: string, route: PageRoute, state: TutorialState) {
  write(guideOfferKey(userId, route), state)
}

/** true면 이 페이지에서 처음 묻는 것 — 보였다는 사실(asked)을 바로 기록한다(답 없이 닫혀도 다시 묻지 않음) */
export function offerGuideOnce(userId: string, route: PageRoute): boolean {
  const key = guideOfferKey(userId, route)
  if (sessionStates.has(key)) return false
  const stored = read(key)
  if (stored) {
    sessionStates.set(key, stored)
    return false
  }
  write(key, 'asked')
  return true
}

/** 내 정보의 '튜토리얼 다시 보기' — 현재 페이지의 가이드 투어를 시작하라는 신호. GuideTour가 받는다 */
export function requestTutorial() {
  window.dispatchEvent(new Event(TUTORIAL_REPLAY))
}
