import { expect, it } from 'vitest'
import { sessionSteps } from './answerSteps.js'
it('retains every output step between polls and pairs tool outputs by call id', () => {
  expect(sessionSteps({ output: [
    { type: 'reasoning', summary: [{ text: '생각' }] }, { type: 'message', content: [{ text: '먼저' }] },
    { type: 'function_call', call_id: 'a', name: 'lookup', arguments: '{"q":1}' },
    { type: 'function_call_output', call_id: 'a', output: [{ type: 'input_text', text: '원문 결과' }] },
    { type: 'open_webui:code_interpreter', code: 'print(1)', output: '1', status: 'completed' },
    { type: 'message', content: [{ text: '나중' }] },
  ] })).toEqual([
    { type: 'reasoning', text: '생각' }, { type: 'text', text: '먼저' },
    { type: 'tool', name: 'lookup', input: '{"q":1}', output: '원문 결과', status: 'done' },
    { type: 'code', code: 'print(1)', output: '1', status: 'done' }, { type: 'text', text: '나중' },
  ])
})
it('uses legacy content when output has no message, and preserves raw structured output', () => {
  expect(sessionSteps({ content: '옛 답변' })).toEqual([{ type: 'text', text: '옛 답변' }])
  expect(sessionSteps({ output: [{ type: 'function_call', call_id: 'a', name: 'run', arguments: {} },
    { type: 'function_call_output', call_id: 'a', output: { answer: 42 } }] })[0]).toMatchObject({ input: '{}', output: '{"answer":42}', status: 'done' })
})

it('retains structured and mixed tool result data without dropping non-text parts or metadata', () => {
  const output = [{ type: 'input_text', text: '본문', metadata: { count: 3 } }, { type: 'image_url', image_url: { url: '/image.png' } }]
  expect(sessionSteps({ output: [{ type: 'function_call', call_id: 'a', name: 'lookup', arguments: '{}' },
    { type: 'function_call_output', call_id: 'a', output }] })[0]).toMatchObject({ output: JSON.stringify(output) })
})

it('finishes code execution when the session is done even if the output omits a terminal status', () => {
  expect(sessionSteps({ done: true, output: [{ type: 'open_webui:code_interpreter', code: 'print(1)', output: '1' }] })[0]).toMatchObject({ status: 'done' })
})
