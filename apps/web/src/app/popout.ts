const KEY = 'mes-popout'
/** 작은 대화 창 — `popup`이 있어야 탭이 아니라 별도 창으로 열린다 */
const FEATURES = 'popup,width=560,height=760'
let cached: boolean | undefined

/**
 * 이 창이 '새 창으로 띄우기'로 열린 팝업인지. 첫 로드의 `?popout=1`을 이 창의 sessionStorage에 남겨, 팝업 안에서 다른 화면으로 가거나 새로고침해도 모드가 유지된다.
 * 팝업에서는 사이드바·상단 바 내비·도우미 알약(말풍선·가이드 포함)을 숨긴다 — AppShell·TopBar·TaskHeader가 읽는다
 */
export function isPopout(): boolean {
  if (cached === undefined) {
    let flag = false
    try {
      flag = new URLSearchParams(window.location.search).get('popout') === '1' || sessionStorage.getItem(KEY) === '1'
      if (flag) sessionStorage.setItem(KEY, '1')
    } catch { /* 저장소를 못 쓰면 URL만 본다 */ }
    cached = flag
  }
  return cached
}

export const popoutUrl = (taskId: string) => `/c/${encodeURIComponent(taskId)}?popout=1`

/** 대화를 작은 창으로 연다. 창 이름이 대화별이라 같은 대화는 기존 창을 다시 쓴다. 막히면 false — 호출자가 토스트로 안내하고 같은 탭으로 옮기지 않는다 */
export function openPopout(taskId: string): boolean {
  return window.open(popoutUrl(taskId), `mes-popout-${taskId}`, FEATURES) !== null
}

/** 테스트용 — 판정 캐시와 세션 표식을 지운다 */
export function resetPopout() {
  cached = undefined
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
}
