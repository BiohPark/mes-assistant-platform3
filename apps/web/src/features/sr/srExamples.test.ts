import { expect, it } from 'vitest'
import { exampleQuestionsFrom } from './srExamples'

it('extracts only quoted list items from a markdown usageExample — header and unquoted lines are not chips', () => {
  const usage = '### 사용법\n- 시작\n- "설비 알람 원인을 확인해 주세요"\n- 첨부 파일을 올리세요\n-  "리포트 요청"  \n- "설비 알람 원인을 확인해 주세요"'
  expect(exampleQuestionsFrom(usage)).toEqual(['설비 알람 원인을 확인해 주세요', '리포트 요청'])
})

it('returns nothing when no quoted item exists (no platform fallback)', () => {
  expect(exampleQuestionsFrom('### 사용법\n- 시작\n- 첨부를 올리세요')).toEqual([])
  expect(exampleQuestionsFrom('')).toEqual([])
  expect(exampleQuestionsFrom(undefined)).toEqual([])
})

it('falls back to the agent AI-suggested first questions only when the SO wrote none', () => {
  expect(exampleQuestionsFrom('- "SO 예시"', ['AI 질문'])).toEqual(['SO 예시'])
  expect(exampleQuestionsFrom('### 사용법\n- 시작', ['AI 질문', 'AI 질문', '둘째'])).toEqual(['AI 질문', '둘째'])
  expect(exampleQuestionsFrom(undefined, undefined)).toEqual([])
})
