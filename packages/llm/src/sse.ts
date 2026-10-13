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
  reasoning: string
  toolCalls: ToolCallFragment[]
}

interface OpenAiToolCallDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

/** OpenAI-compatible 스트리밍 청크에서 텍스트/툴콜 조각을 안전하게 꺼낸다. */
export function extractDelta(chunk: unknown): DeltaResult {
  const empty: DeltaResult = { text: '', reasoning: '', toolCalls: [] }
  if (!chunk || typeof chunk !== 'object') return empty
  const choices = (chunk as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return empty
  const choice = choices[0]
  if (!choice || typeof choice !== 'object') return empty
  const delta = (choice as { delta?: unknown }).delta
  if (!delta || typeof delta !== 'object') return empty
  const d = delta as { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; tool_calls?: unknown }
  const text = typeof d.content === 'string' ? d.content : ''
  const reasoning = typeof d.reasoning_content === 'string' ? d.reasoning_content : typeof d.reasoning === 'string' ? d.reasoning : ''
  const toolCalls: ToolCallFragment[] = Array.isArray(d.tool_calls)
    ? (d.tool_calls as OpenAiToolCallDelta[]).filter((tc) => tc && typeof tc === 'object').map((tc, i) => ({
        index: tc.index ?? i,
        id: tc.id,
        name: tc.function?.name,
        arguments: tc.function?.arguments ?? '',
      }))
    : []
  return { text, reasoning, toolCalls }
}

export type TextChunk = { type: 'delta' | 'reasoning'; text: string }

/** Keep only a possible tag suffix between deltas; tags may cross any SSE/network boundary. */
export class ThinkSplitter {
  private pending = ''
  private thinking = false

  push(text: string): TextChunk[] {
    this.pending += text
    const chunks: TextChunk[] = []
    while (this.pending) {
      const tag = this.thinking ? '</think>' : '<think>'
      const index = this.pending.indexOf(tag)
      if (index >= 0) {
        if (index) chunks.push({ type: this.thinking ? 'reasoning' : 'delta', text: this.pending.slice(0, index) })
        this.pending = this.pending.slice(index + tag.length)
        this.thinking = !this.thinking
        continue
      }
      let held = Math.min(tag.length - 1, this.pending.length)
      while (held && !tag.startsWith(this.pending.slice(-held))) held--
      const ready = this.pending.slice(0, this.pending.length - held)
      if (ready) chunks.push({ type: this.thinking ? 'reasoning' : 'delta', text: ready })
      this.pending = this.pending.slice(this.pending.length - held)
      break
    }
    return chunks
  }

  finish(): TextChunk[] {
    const chunks: TextChunk[] = this.pending ? [{ type: this.thinking ? 'reasoning' : 'delta', text: this.pending }] : []
    this.pending = ''
    return chunks
  }
}
