/**
 * 서버 무응답 제한(REQUEST_IDLE_MS·REQUEST_FIRST_TOKEN_MS) 기본값 300초.
 * 서버가 요청별 제한을 화면에 알려 주지 않아 같은 기본값으로 남은 시간을 어림한다(첨부가 있는 첫 응답 제한은 더 길다).
 */
export const RESPONSE_LIMIT_MS = 300_000
/** 신호(본문·생각·단계 변화)가 이만큼 없으면 '응답 대기 중 — 제한까지 남은 시간'으로 바꾼다 */
export const QUIET_AFTER_MS = 20_000
