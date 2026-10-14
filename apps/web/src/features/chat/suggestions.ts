const DEFAULT_SUGGESTIONS = ['시작', '선택한 입력 기준으로 초안 작성해줘', '누락된 항목 확인 질문 만들어줘']

/** Composer 첫 제안: SO가 usageExample에 인용한 예시 → 없으면 에이전트별 AI 추천 첫 질문(suggestedQuestions) → 둘 다 없으면 기본 제안 */
export function suggestionsFrom(usageExample: string, suggested: string[] = []): string[] {
  const found = [...usageExample.matchAll(/^-\s*"(.+?)"\s*$/gm)].map((match) => match[1])
  const picked = found.length ? found : suggested
  return picked.length ? ['시작', ...picked.filter((item) => item !== '시작')].slice(0, 4) : DEFAULT_SUGGESTIONS
}
