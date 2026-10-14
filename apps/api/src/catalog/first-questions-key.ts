import { createHash } from 'node:crypto'

// 카탈로그 조회(catalog.service)가 쓰는 순수 함수 — RequestsService를 끌어오지 않아야 dbLlmPorts와 순환하지 않는다
export type FirstQuestionsSource = { modelId?: string | null; name: string; summary: string }

/** 추천 첫 질문을 만든 기준(modelId·이름·설명)의 sha256 hex. 지금 값과 다르면 저장본은 낡은 것이다 */
export const firstQuestionsKey = (row: FirstQuestionsSource) => createHash('sha256').update(JSON.stringify([row.modelId ?? null, row.name, row.summary])).digest('hex')

/** 지금 기준으로 만든 저장본만 돌려준다. 없거나 낡았으면 undefined */
export function freshFirstQuestions(row: FirstQuestionsSource & { suggestedQuestions: unknown; suggestedFor: string | null }): string[] | undefined {
  if (row.suggestedFor !== firstQuestionsKey(row) || !Array.isArray(row.suggestedQuestions)) return undefined
  return row.suggestedQuestions.filter((item): item is string => typeof item === 'string')
}
