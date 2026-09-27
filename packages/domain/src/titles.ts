const MAX_TITLE = 30
/** 제목 근거로 쓰기엔 의미 없는 첫 메시지 (시작 신호·인사) */
const TRIVIAL = /^(시작|start|hi|hello|안녕(하세요)?|ㅎㅇ)[\s.!?~]*$/i

/** 모델이 돌려준 제목 한 줄 정리: 따옴표·마크다운·접두어 제거, 길이 제한 */
export function cleanTitle(raw: string): string {
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean) ?? ''
  const t = line
    .replace(/^(제목|title)\s*[:：]\s*/i, '')
    .replace(/^[#>*\-\s]+/, '')
    .replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, '')
    .replace(/[*_`]/g, '')
    .trim()
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE).trimEnd()}…` : t
}

/**
 * 규칙 기반 제목 (mock 모드·AI 실패 시 폴백).
 * 의미 있는 첫 사용자 메시지의 첫 문장을 쓴다. 없으면 undefined(기존 기본 제목 유지).
 */
export function ruleTitle(userTexts: string[]): string | undefined {
  const text = userTexts.map((t) => t.trim()).find((t) => t && !TRIVIAL.test(t))
  if (!text) return undefined
  const first = text.split(/(?<=[.!?。])\s|\n/)[0].replace(/[.!?。]+$/, '')
  const t = cleanTitle(first)
  return t || undefined
}
