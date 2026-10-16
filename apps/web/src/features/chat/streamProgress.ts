/**
 * 서버 무응답 제한(REQUEST_IDLE_MS·REQUEST_FIRST_TOKEN_MS) 기본값 300초.
 * 서버가 요청별 제한을 화면에 알려 주지 않아 같은 기본값으로 남은 시간을 어림한다(첨부가 있는 첫 응답 제한은 더 길다).
 */
export const RESPONSE_LIMIT_MS = 300_000
/** 신호(본문·생각·단계 변화)가 이만큼 없으면 '응답 대기 중 — 제한까지 남은 시간'으로 바꾼다 */
export const QUIET_AFTER_MS = 20_000
/** 서버 최대 처리 시간(REQUEST_MAX_MS) 기본값 30분 — OpenWebUI 작업 중일 때의 남은 시간(옛 서버가 알려 주지 않으면) */
export const MAX_LIMIT_MS = 1_800_000
/** 본문이 이만큼 그대로면 답 아래에도 진행 상태를 보인다 — 다 쓴 것처럼 보이는 답 옆에서 조용히 도는 일이 없게 */
export const STALLED_AFTER_MS = 3_000
