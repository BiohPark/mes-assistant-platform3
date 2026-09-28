/** SSE 버퍼에서 완결된 data 페이로드를 추출한다. 미완결 부분은 rest로 돌려준다. */
export function parseSseLines(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const blocks = normalized.split('\n\n')
  const rest = blocks.pop() ?? ''
  const events: string[] = []
  for (const block of blocks) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (data) events.push(data)
  }
  return { events, rest }
}

export interface ToolCallFragment {
  index: number
  id?: string
  name?: string
  arguments: string
}

export interface DeltaResult {
  text: string
  toolCalls: ToolCallFragment[]
}

interface OpenAiToolCallDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

/** OpenAI-compatible 스트리밍 청크에서 텍스트/툴콜 조각을 안전하게 꺼낸다. */
export function extractDelta(chunk: unknown): DeltaResult {
  const empty: DeltaResult = { text: '', toolCalls: [] }
  if (!chunk || typeof chunk !== 'object') return empty
  const choices = (chunk as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return empty
  const delta = (choices[0] as { delta?: unknown }).delta
  if (!delta || typeof delta !== 'object') return empty
  const d = delta as { content?: unknown; tool_calls?: unknown }
  const text = typeof d.content === 'string' ? d.content : ''
  const toolCalls: ToolCallFragment[] = Array.isArray(d.tool_calls)
    ? (d.tool_calls as OpenAiToolCallDelta[]).map((tc, i) => ({
        index: tc.index ?? i,
        id: tc.id,
        name: tc.function?.name,
        arguments: tc.function?.arguments ?? '',
      }))
    : []
  return { text, toolCalls }
}
