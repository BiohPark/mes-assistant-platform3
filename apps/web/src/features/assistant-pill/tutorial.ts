import type { PageRoute } from './pageActions'

export type TutorialState = 'asked' | 'accepted' | 'skipped'
/** 가이드를 한 번만 제안하는 범위 — 페이지, 그리고 에이전트 편집 시트(S13-R) */
export type GuideScope = PageRoute | 'assistantEditor'
/** 사용자·범위별 가이드 제안 상태 — 한 번 보이면(asked) 다시 묻지 않는다 */
export const guideOfferKey = (userId: string, scope: GuideScope) => `tutorial:${userId}:${scope}:v1`
/** 사용자·페이지별 투어 섹션 완료 목록(JSON 배열) */
export const tourProgressKey = (userId: string, route: PageRoute) => `tour-progress:${userId}:${route}:v1`

// Memory survives remounts when storage is blocked or full, and is scoped to this page session.
const sessionStates = new Map<string, TutorialState>()
const sessionProgress = new Map<string, string[]>()
export const TUTORIAL_REPLAY = 'assistant-tutorial-replay'

function writeRaw(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch {
    try { sessionStorage.setItem(key, value) } catch { /* Memory fallback already recorded. */ }
  }
}

function readRaw(key: string): string | null {
  const from = (storage: () => Storage): string | null => {
    try { return storage().getItem(key) } catch { return null }
  }
  return from(() => localStorage) ?? from(() => sessionStorage)
}

function write(key: string, state: TutorialState) {
  sessionStates.set(key, state)
  writeRaw(key, state)
}

function read(key: string): TutorialState | null {
  const stored = readRaw(key)
  return stored === 'asked' || stored === 'accepted' || stored === 'skipped' ? stored : null
}

export function saveGuideOffer(userId: string, scope: GuideScope, state: TutorialState) {
  write(guideOfferKey(userId, scope), state)
}

/** true면 이 범위에서 처음 묻는 것 — 보였다는 사실(asked)을 바로 기록한다(답 없이 닫혀도 다시 묻지 않음) */
export function offerGuideOnce(userId: string, scope: GuideScope): boolean {
  const key = guideOfferKey(userId, scope)
  if (sessionStates.has(key)) return false
  const stored = read(key)
  if (stored) {
    sessionStates.set(key, stored)
    return false
  }
  write(key, 'asked')
  return true
}

/** 완료한 섹션 id — 깨진 값은 빈 목록으로 본다 */
export function readTourProgress(userId: string, route: PageRoute): string[] {
  const key = tourProgressKey(userId, route)
  const raw = readRaw(key)
  if (raw === null) return sessionProgress.get(key) ?? [] // 저장이 막힌 세션의 폴백
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

/** 섹션을 완료로 기록하고 전체 목록을 돌려준다. 저장이 막혀도 이번 세션에는 남는다 */
export function markSectionDone(userId: string, route: PageRoute, sectionId: string): string[] {
  const key = tourProgressKey(userId, route)
  const current = readTourProgress(userId, route)
  const next = current.includes(sectionId) ? current : [...current, sectionId]
  sessionProgress.set(key, next)
  writeRaw(key, JSON.stringify(next))
  return next
}

/** 내 정보의 '튜토리얼 다시 보기' — 현재 페이지의 가이드 투어를 시작하라는 신호. GuideTour가 받는다 */
export function requestTutorial() {
  window.dispatchEvent(new Event(TUTORIAL_REPLAY))
}
