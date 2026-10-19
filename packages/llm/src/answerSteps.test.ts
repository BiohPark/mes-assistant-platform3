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

it('parses details reasoning, code and tool attributes in order without losing surrounding markdown', () => {
  const content = '먼저\n<details type="reasoning" done="true"><summary>Thinking</summary>검토 &amp; 확인</details>\n중간\n<details type="code_interpreter" done="true"><summary>Code</summary>\n```python\nprint(1)\n```\n```output\n1\n```\n</details>\n<details type="tool_calls" done="true" name="lookup" arguments="{&quot;q&quot;:&quot;원문&quot;}" result="{&quot;answer&quot;:42}"><summary>Tool</summary></details>\n**답변**'
  expect(sessionSteps({ content }).map(s => s.type)).toEqual(['text', 'reasoning', 'text', 'code', 'tool', 'text'])
  const steps = sessionSteps({ content })
  expect(steps[1]).toEqual({ type: 'reasoning', text: '검토 & 확인' })
  expect(steps[3]).toEqual({ type: 'code', code: 'print(1)', output: '1', status: 'done' })
  expect(steps[4]).toEqual({ type: 'tool', name: 'lookup', input: '{"q":"원문"}', output: '{"answer":42}', status: 'done' })
  expect(steps.at(-1)).toEqual({ type: 'text', text: '\n**답변**' })
})
it('keeps incomplete details running and never exposes partial markup as answer text', () => {
  expect(sessionSteps({ content: '<details type="code_interpreter" done="false"><summary>Code</summary>```sh\necho hi' })).toEqual([
    { type: 'code', code: 'echo hi', output: '', status: 'running' },
  ])
  expect(sessionSteps({ content: '<details type="reasoning" done="false"><summary>Thinking</summary>still thinking</details>' })).toEqual([{ type: 'reasoning', text: 'still thinking' }])
})
it('prefers structured output over duplicated details while retaining content-only answers', () => {
  const content = '<details type="reasoning">duplicate</details>answer'
  expect(sessionSteps({ content, output: [{ type: 'reasoning', content: [{ text: 'original' }] }, { type: 'message', content: [{ text: 'answer' }] }] })).toEqual([{ type: 'reasoning', text: 'original' }, { type: 'text', text: 'answer' }])
  expect(sessionSteps({ content, output: [{ type: 'reasoning', content: [{ text: 'original' }] }] })).toEqual([{ type: 'reasoning', text: 'original' }, { type: 'text', text: 'answer' }])
})
it('leaves literal tags in fenced code and ordinary details intact, and supports nested details in reasoning', () => {
  const literal = '```html\n<details type="reasoning">example</details>\n```\n<details><summary>More</summary>ordinary</details>'
  expect(sessionSteps({ content: literal })).toEqual([{ type: 'text', text: literal }])
  expect(sessionSteps({ content: '<details type="reasoning"><summary>Think</summary>a<details><summary>More</summary>b</details>c</details>answer' })).toEqual([{ type: 'reasoning', text: 'a<details><summary>More</summary>b</details>c' }, { type: 'text', text: 'answer' }])
})
it('reads the OpenWebUI serialized forms: quoted reasoning, output attribute JSON and JSON-encoded tool values', () => {
  const output = '{&quot;stdout&quot;: &quot;hi\\n&quot;, &quot;stderr&quot;: &quot;&quot;}'
  const content = '<details type="reasoning" done="true" duration="3">\n<summary>Thought for 3 seconds</summary>\n> 첫 줄\n>\n> 둘째 줄\n</details>\n'
    + `<details type="code_interpreter" done="true" output="${output}">\n<summary>Analyzed</summary>\n\`\`\`python\nprint("hi")\n\`\`\`\n\`\`\`output\n${output}\n\`\`\`\n</details>\n`
    + '<details type="tool_calls" done="true" id="c1" name="search" arguments="{&quot;q&quot;: &quot;mes&quot;}" result="&quot;찾은 결과&quot;">\n<summary>Tool Executed</summary>\n</details>\n답'
  const steps = sessionSteps({ content })
  expect(steps.map(s => s.type)).toEqual(['reasoning', 'code', 'tool', 'text'])
  expect(steps[0]).toEqual({ type: 'reasoning', text: '첫 줄\n\n둘째 줄' })
  expect(steps[1]).toEqual({ type: 'code', code: 'print("hi")', output: 'hi\n', status: 'done' })
  expect(steps[2]).toEqual({ type: 'tool', name: 'search', input: '{"q": "mes"}', output: '찾은 결과', status: 'done' })
})
it('keeps a quote-prefixed reasoning line as written when not every line is quoted', () => {
  expect(sessionSteps({ content: '<details type="reasoning" done="true"><summary>T</summary>\n> 인용\n평문\n</details>' })[0]).toEqual({ type: 'reasoning', text: '> 인용\n평문' })
})
