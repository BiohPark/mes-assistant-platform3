import { expect, it } from 'vitest'
import { suggestionsFrom } from './suggestions'

it('SO가 적은 첫 질문 예시(usageExample 인용 항목)를 AI 추천보다 우선한다', () => {
  expect(suggestionsFrom('- "알람 확인"\n- "시작"', ['AI 질문'])).toEqual(['시작', '알람 확인'])
})

it('SO 예시가 없으면 에이전트별 AI 추천 첫 질문을 쓴다', () => {
  expect(suggestionsFrom('### 사용법\n- 첨부를 올리세요', ['첫째', '둘째', '셋째'])).toEqual(['시작', '첫째', '둘째', '셋째'])
})

it('둘 다 없으면 기본 제안', () => {
  expect(suggestionsFrom('', [])).toEqual(['시작', '선택한 입력 기준으로 초안 작성해줘', '누락된 항목 확인 질문 만들어줘'])
  expect(suggestionsFrom('')).toEqual(['시작', '선택한 입력 기준으로 초안 작성해줘', '누락된 항목 확인 질문 만들어줘'])
})
