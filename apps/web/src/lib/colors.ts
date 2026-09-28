export const ASSISTANT_COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#db2777', '#4f46e5', '#65a30d'] as const

/** 문자열 해시로 결정적 색을 고른다 (같은 id는 항상 같은 색). */
export function pickColor(seed: string): string {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ASSISTANT_COLORS[h % ASSISTANT_COLORS.length]
}

/**
 * 이니셜 규칙
 * - 첫 단어가 2~3자 대문자 약어(URS, FDS, SR)면 그대로
 * - 한글로 시작하면 첫 글자
 * - 그 외 단어별 첫 글자 최대 2개
 */
export function initialsOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const words = trimmed.split(/\s+/)
  if (/^[A-Z]{2,3}$/.test(words[0])) return words[0]
  if (/[가-힣]/.test(trimmed[0])) return trimmed[0]
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

/** 한글보다 영문을 앞에 두는 정렬 (ET 개발 < 공통) */
export function compareKo(a: string, b: string): number {
  return a.localeCompare(b, 'en')
}
