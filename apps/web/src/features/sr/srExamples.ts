/**
 * 접수 에이전트 usageExample(마크다운: "### 사용법\n- 시작\n- \"…\"")에서 첫 질문 예시만 뽑는다.
 * features/chat/suggestions.ts와 같은 규칙(인용된 목록 항목)이되 플랫폼 기본 제안 폴백은 없다 — 데이터만.
 */
export function exampleQuestionsFrom(usageExample: string | undefined): string[] {
  const found = [...(usageExample ?? '').matchAll(/^-\s*"(.+?)"\s*$/gm)].map(match => match[1]!)
  return [...new Set(found)]
}
