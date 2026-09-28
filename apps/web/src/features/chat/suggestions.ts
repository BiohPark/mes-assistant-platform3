const DEFAULT_SUGGESTIONS = ['시작', '선택한 입력 기준으로 초안 작성해줘', '누락된 항목 확인 질문 만들어줘']

export function suggestionsFrom(usageExample: string): string[] {
  const found = [...usageExample.matchAll(/^-\s*"(.+?)"\s*$/gm)].map((match) => match[1])
  return found.length ? ['시작', ...found.filter((item) => item !== '시작')].slice(0, 4) : DEFAULT_SUGGESTIONS
}
