import type { SrStatus } from './types.js'

/**
 * SR 화면 단계. DB 상태값(submitted·reviewing·…)은 그대로 두고 표시·집계만 합친다.
 * reviewing(옛 "검토 중")은 접수됨(submitted)으로 보인다 — 사내 데이터의 기존 행을 바꾸지 않는다.
 */
export type SrStage = Exclude<SrStatus, 'reviewing'>

/** 요청자에게 보이는 정상 흐름 4단계 (접수됨 → 처리 중 → 결과 공유 → 완료) */
export const SR_STAGE_FLOW: SrStage[] = ['submitted', 'in_progress', 'responded', 'done']
/** 필터·집계 단계: 정상 흐름 + 반려 */
export const SR_STAGES: SrStage[] = [...SR_STAGE_FLOW, 'rejected']

export function srStage(status: SrStatus): SrStage {
  return status === 'reviewing' ? 'submitted' : status
}

/** 담당자가 직접 고를 수 있는 상태. 접수됨·결과 공유는 자동 전환(접수·연결 대화 시작·결과 공유)으로만 들어간다. */
export const SR_MANUAL_STATUSES = ['in_progress', 'done', 'rejected'] as const
export type SrManualStatus = (typeof SR_MANUAL_STATUSES)[number]

/** 사유 필수 여부 — 반려는 항상, 완료도 현행대로 필수. 바꾸려면 여기만 고친다. */
export function srReasonRequired(status: SrStatus): boolean {
  return status === 'done' || status === 'rejected'
}

/** 완료·반려 = 닫힌 SR. 다시 열기(→ 처리 중)는 여기서만 가능하다. */
export function isSrClosed(status: SrStatus): boolean {
  return status === 'done' || status === 'rejected'
}
