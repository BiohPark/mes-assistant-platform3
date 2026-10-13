export type TutorialState = 'asked' | 'accepted' | 'skipped'
export const tutorialKey = (userId: string) => `tutorial:${userId}:v1`

// Memory survives drawer remounts when storage is blocked or full, and is scoped to this page session.
const sessionStates = new Map<string, TutorialState>()
const replays = new Set<string>()
export const TUTORIAL_REPLAY = 'assistant-tutorial-replay'

export function saveTutorialState(userId: string, state: TutorialState) {
  sessionStates.set(userId, state)
  try { localStorage.setItem(tutorialKey(userId), state) } catch {
    try { sessionStorage.setItem(tutorialKey(userId), state) } catch { /* Memory fallback already recorded. */ }
  }
}

export function askTutorialOnce(userId: string): boolean {
  if (sessionStates.has(userId)) return false
  const read = (storage: () => Storage): TutorialState | null => {
    try {
      const stored = storage().getItem(tutorialKey(userId))
      return stored === 'asked' || stored === 'accepted' || stored === 'skipped' ? stored : null
    } catch { return null }
  }
  const stored = read(() => localStorage) ?? read(() => sessionStorage)
  if (stored) {
    sessionStates.set(userId, stored)
    return false
  }
  saveTutorialState(userId, 'asked')
  return true
}

export function requestTutorial(userId: string) {
  saveTutorialState(userId, 'accepted')
  replays.add(userId)
  window.dispatchEvent(new Event(TUTORIAL_REPLAY))
}

export function takeTutorialReplay(userId: string): boolean {
  return replays.delete(userId)
}
