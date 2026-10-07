import { expect, it } from 'vitest'
import { mockSystemAssistant } from './mockSystemAssistant.js'
import { SYSTEM_TOOLS } from './tools.js'

it('ID 없는 에이전트 등록은 서버 생성에 맡기고 명시한 기존 ID는 전달한다', () => {
  const generated = mockSystemAssistant('에이전트 등록: 이름 새 도우미, Record › 라벨')
  expect(generated.toolCalls).toHaveLength(1)
  expect(JSON.parse(generated.toolCalls[0]!.arguments)).toEqual({ name: '새 도우미', level1: 'Record', level2: '라벨', summary: '' })
  const explicit = mockSystemAssistant('에이전트 등록: ID legacy-id, 이름 새 도우미, Record › 라벨')
  expect(JSON.parse(explicit.toolCalls[0]!.arguments)).toMatchObject({ id: 'legacy-id' })
  const parameters = SYSTEM_TOOLS.find((tool) => tool.function.name === 'create_assistant')!.function.parameters
  expect(parameters.required).toEqual(['name', 'level1', 'level2'])
})


it('영어 UI의 등록 예시도 ID 없는 등록 제안을 만든다', () => {
  const proposed = mockSystemAssistant('Register an agent named Label Validation Helper, Record › Label')
  expect(proposed.toolCalls).toHaveLength(1)
  expect(proposed.toolCalls[0]!.name).toBe('create_assistant')
  expect(JSON.parse(proposed.toolCalls[0]!.arguments)).toEqual({ name: 'Label Validation Helper', level1: 'Record', level2: 'Label', summary: '' })
})
