// 실제 OpenWebUI처럼 답변을 점진 직렬화하는 시나리오(S16) — 의존성 없음. 가짜 서버와 단위 테스트가 같이 쓴다.
// 세션 모드: OpenWebUI는 content_blocks를 폴링마다 다시 직렬화한다(middleware serialize_content_blocks) — 진행 중 블록도
// 닫는 태그까지 쓰고 done="false"만 다르며, 텍스트 블록은 앞뒤 공백을 다듬어 줄바꿈으로 잇는다. 생각은 '> ' 인용 + html.escape.
// 직접(SSE) 모드: 같은 흐름을 앞으로만 자라는 글로 4~16자 조각에 나눠 보낸다(태그 중간에서도 끊긴다).

/** python html.escape(quote=True) */
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
const quote = text => text.split('\n').map(line => line.startsWith('>') ? line : `> ${line}`).join('\n')

export const PROGRESSIVE = {
  intro: '안녕하세요. 요청을 먼저 살펴보겠습니다.',
  thought: ['PROGRESSIVE_THOUGHT 요청을 검토합니다.', '자료를 비교합니다.', '계산이 필요합니다.'],
  middle: '검토 결과를 정리했습니다. 계산을 실행합니다.',
  code: 'print(1 + 1)',
  codeOutput: { stdout: '2\n' },
  after: '계산 결과는 2입니다. 이제 도구로 확인합니다.',
  tool: { id: 'call_progressive', name: 'fake_tool', arguments: { query: 'progressive input' }, result: 'progressive result' },
  final: '**PROGRESSIVE_END** 확인을 마쳤습니다.',
}

/** OpenWebUI serialize_content_blocks(raw=False) 흉내 */
export function serializeBlocks(blocks) {
  let content = ''
  const newline = () => { if (content && !content.endsWith('\n')) content += '\n' }
  for (const block of blocks) {
    if (block.type === 'text') {
      const text = block.content.trim()
      if (text) content += `${text}\n`
    } else if (block.type === 'reasoning') {
      newline()
      const body = escape(quote(block.content))
      content += block.duration !== undefined
        ? `<details type="reasoning" done="true" duration="${block.duration}">\n<summary>Thought for ${block.duration} seconds</summary>\n${body}\n</details>\n`
        : `<details type="reasoning" done="false">\n<summary>Thinking…</summary>\n${body}\n</details>\n`
    } else if (block.type === 'code_interpreter') {
      newline()
      content += block.output
        ? `<details type="code_interpreter" done="true" output="${escape(JSON.stringify(block.output))}">\n<summary>Analyzed</summary>\n\`\`\`python\n${block.content}\n\`\`\`\n</details>\n`
        : `<details type="code_interpreter" done="false">\n<summary>Analyzing...</summary>\n\`\`\`python\n${block.content}\n\`\`\`\n</details>\n`
    } else if (block.type === 'tool_calls') {
      newline()
      for (const call of block.content) {
        const args = escape(JSON.stringify(call.arguments))
        content += block.results
          ? `<details type="tool_calls" done="true" id="${call.id}" name="${call.name}" arguments="${args}" result="${escape(JSON.stringify(block.results[call.id]))}" files="">\n<summary>Tool Executed</summary>\n</details>\n`
          : `<details type="tool_calls" done="false" id="${call.id}" name="${call.name}" arguments="${args}">\n<summary>Executing...</summary>\n</details>\n`
      }
    }
  }
  return content.trim()
}

/** 4~16자 조각(결정적) — 서로게이트 쌍은 가르지 않는다 */
export function pieces(text, sizes = [4, 7, 11, 16, 5, 9, 13, 6]) {
  const chars = [...text]
  const out = []
  for (let i = 0, n = 0; i < chars.length; n++) {
    const size = sizes[n % sizes.length]
    out.push(chars.slice(i, i + size).join(''))
    i += size
  }
  return out
}

/** OpenWebUI v0.12 output[] 항목 — 마지막 상태(늦게 채워지는 경우 끝에 한꺼번에) */
function outputItems(s) {
  const text = value => ({ type: 'message', content: [{ type: 'output_text', text: value }] })
  return [text(s.intro), { type: 'reasoning', content: [{ type: 'output_text', text: s.thought.join('\n') }] }, text(s.middle),
    { type: 'open_webui:code_interpreter', code: s.code, output: s.codeOutput.stdout, status: 'completed' }, text(s.after),
    { type: 'function_call', call_id: s.tool.id, name: s.tool.name, arguments: JSON.stringify(s.tool.arguments), status: 'completed' },
    { type: 'function_call_output', call_id: s.tool.id, output: [{ type: 'input_text', text: s.tool.result }], status: 'completed' }, text(s.final)]
}

/**
 * 세션 폴링 스냅숏 — [{ content, output }]. output: 'empty'(늘 비어 있음 — 사내 가정), 'late'(마지막에만 채움),
 * 'tools'(도구·코드 항목만 실행 시점에 생김 — 글·생각은 content에만).
 */
export function sessionFrames(output = 'empty', s = PROGRESSIVE) {
  const blocks = [], frames = []
  const items = []
  const snap = () => frames.push({ content: serializeBlocks(blocks), output: items.map(item => ({ ...item })) })
  const grow = (block, text) => { for (const piece of pieces(text)) { block.content += piece; snap() } }
  const textBlock = () => { const block = { type: 'text', content: '' }; blocks.push(block); return block }
  grow(textBlock(), s.intro)
  const reasoning = { type: 'reasoning', content: '' }
  blocks.push(reasoning)
  snap() // 열린 빈 생각
  s.thought.forEach((line, index) => grow(reasoning, (index ? '\n' : '') + line))
  reasoning.duration = 3
  snap()
  grow(textBlock(), s.middle)
  const code = { type: 'code_interpreter', content: s.code }
  blocks.push(code)
  if (output === 'tools') items.push({ type: 'open_webui:code_interpreter', code: s.code, output: '', status: 'in_progress' })
  snap()
  code.output = s.codeOutput
  if (output === 'tools') items[items.length - 1] = { ...items.at(-1), output: s.codeOutput.stdout, status: 'completed' }
  snap()
  grow(textBlock(), s.after)
  const tool = { type: 'tool_calls', content: [s.tool] }
  blocks.push(tool)
  if (output === 'tools') items.push({ type: 'function_call', call_id: s.tool.id, name: s.tool.name, arguments: JSON.stringify(s.tool.arguments), status: 'in_progress' })
  snap()
  tool.results = { [s.tool.id]: s.tool.result }
  if (output === 'tools') {
    items[items.length - 1] = { ...items.at(-1), status: 'completed' }
    items.push({ type: 'function_call_output', call_id: s.tool.id, output: [{ type: 'input_text', text: s.tool.result }], status: 'completed' })
  }
  snap()
  grow(textBlock(), s.final)
  if (output === 'late') frames.at(-1).output = outputItems(s)
  return frames
}

/** 직접(SSE) 모드 — 앞으로만 자라는 같은 흐름의 원문(생각은 done="false"로 열렸다 닫히고, 도구·코드는 끝난 형태로 이어 쓴다) */
export function directMarkup(s = PROGRESSIVE) {
  const thought = escape(quote(s.thought.join('\n')))
  return `${s.intro}\n<details type="reasoning" done="false">\n<summary>Thinking…</summary>\n${thought}\n</details>\n${s.middle}\n`
    + serializeBlocks([{ type: 'code_interpreter', content: s.code, output: s.codeOutput }]) + `\n${s.after}\n`
    + serializeBlocks([{ type: 'tool_calls', content: [s.tool], results: { [s.tool.id]: s.tool.result } }]) + `\n${s.final}`
}

export const directPieces = (s = PROGRESSIVE) => pieces(directMarkup(s))
