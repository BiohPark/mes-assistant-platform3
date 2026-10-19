import { boundStepPayload, type AnswerStep } from '@mes/domain'

const decode = (text: string) => text.replace(/&(#x[\da-f]+|#\d+|quot|apos|amp|lt|gt|nbsp);/gi, (entity, name: string) => {
  if (name[0] === '#') {
    const code = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  }
  return ({ quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp: '\u00a0' } as Record<string, string>)[name.toLowerCase()] ?? entity
})
const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m => [m[1]!.toLowerCase(), decode(m[2] ?? m[3] ?? m[4] ?? '')]))
// The offsets are kept in the original markdown. Only OWUI wrappers and their leading summary are removed.
const tokens = /(^[ \t]*(`{3,}|~{3,})[^\n]*(?:\n|$))|<\/?(?:details|think)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gim
const parseJson = (value: string): unknown => { try { return JSON.parse(value) } catch { return undefined } }
/** OWUI json.dumps-es tool values; a JSON string is shown as its text, anything else as written. */
const unquote = (value: string) => { const parsed = parseJson(value); return typeof parsed === 'string' ? parsed : value }
/** OWUI code_interpreter output attribute: {stdout, stderr, result}. */
function outputAttribute(value: string) {
  const parsed = parseJson(value)
  if (typeof parsed === 'string') return parsed
  if (!parsed || typeof parsed !== 'object') return value
  const out = parsed as Record<string, unknown>
  return ['stdout', 'stderr', 'result'].map(key => out[key]).filter(v => v !== undefined && v !== null && v !== '')
    .map(v => typeof v === 'string' ? v : JSON.stringify(v)).join('\n')
}
/** OWUI quotes reasoning as markdown ('> '); unwrap only when every non-empty line is quoted. */
function unquoteReasoning(text: string) {
  const lines = text.split('\n')
  return lines.some(line => line.trim()) && lines.every(line => !line.trim() || line.startsWith('>')) ? lines.map(line => line.replace(/^> ?/, '')).join('\n') : text
}
function codeParts(body: string) {
  const blocks = [...body.matchAll(/(?:^|\n)[ \t]*(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)(?:\n[ \t]*\1[ \t]*(?=\n|$)|$)/g)]
  const code = blocks.filter(m => !/^(output|result|stdout|stderr)\b/i.test(m[2]!.trim())).map(m => m[3]!).join('\n')
  const output = blocks.filter(m => /^(output|result|stdout|stderr)\b/i.test(m[2]!.trim())).map(m => m[3]!).join('\n')
  return { code: code || (blocks.length ? '' : body.trim()), output }
}
export function contentSteps(content: string, streaming = false): AnswerStep[] { return parseContent(content, streaming).steps }
/**
 * steps plus the settled point: the offset just after the last top-level wrapper that closed, and how many steps
 * precede it. Everything before that offset can no longer change, so a streaming caller may drop it and parse only the rest.
 */
export interface ParsedContent {
  steps: AnswerStep[]; settled: number; settledSteps: number
  /** The content ends inside an open reasoning block whose last step is that reasoning, shown without quote unwrapping. */
  openReasoning: boolean
}
export function parseContent(content: string, streaming = false): ParsedContent {
  const steps: AnswerStep[] = []
  let settled = 0, settledSteps = 0, openReasoning = false
  let fence = '', cursor = 0
  let block: { start: number; body: number; tag: string; depth: number; attrs: Record<string, string> } | undefined
  const text = (value: string) => { if (value.trim()) steps.push({ type: 'text', text: value }) }
  const emit = (end: number, closed: boolean) => {
    if (!block) return
    const b = block
    let body = content.slice(b.body, end).replace(/^\s*<summary\b[^>]*>[\s\S]*?<\/summary>/i, '')
    if (streaming && /^\s*<summary\b/i.test(body)) body = ''
    if (streaming && !closed) body = body.replace(/<\/?(?:d(?:e(?:t(?:a(?:i(?:l(?:s)?)?)?)?)?)?|t(?:h(?:i(?:n(?:k)?)?)?)?)[^>]*$/i, '')
    const kind = b.tag === 'think' ? 'reasoning' : b.attrs.type
    if (kind === 'reasoning') {
      const decoded = decode(body.trim())
      const text = unquoteReasoning(decoded)
      openReasoning = !closed && !!text && text === decoded
      steps.push({ type: 'reasoning', text })
    }
    else if (kind === 'code_interpreter') {
      const code = codeParts(decode(body))
      // The output attribute is the structured result; a raw ```output fence repeats it, so the attribute wins.
      const output = b.attrs.output !== undefined ? outputAttribute(b.attrs.output) : code.output
      steps.push({ type: 'code', code: boundStepPayload(code.code), output: boundStepPayload(output), status: b.attrs.done === 'false' || !closed ? 'running' : b.attrs.status === 'error' ? 'error' : 'done' })
    } else {
      steps.push({ type: 'tool', name: b.attrs.name ?? '?', input: boundStepPayload(unquote(b.attrs.arguments ?? '')), output: boundStepPayload(b.attrs.result !== undefined ? unquote(b.attrs.result) : decode(body.trim())), status: b.attrs.done === 'false' || !closed ? 'running' : b.attrs.status === 'error' ? 'error' : 'done' })
    }
    block = undefined
  }
  for (const m of content.matchAll(tokens)) {
    if (m[1]) {
      const marker = m[2]!
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''
      continue
    }
    if (fence) continue
    const tag = /^<\/?(\w+)/.exec(m[0])![1]!.toLowerCase()
    const closing = m[0].startsWith('</')
    if (block) {
      if (tag === block.tag) {
        block.depth += closing ? -1 : 1
        if (block.depth === 0) { emit(m.index!, true); cursor = settled = m.index! + m[0].length; settledSteps = steps.length }
      }
      continue
    }
    const attrs = attributes(m[0])
    if (!closing && (tag === 'think' || ['reasoning', 'code_interpreter', 'tool_calls'].includes(attrs.type ?? ''))) {
      text(content.slice(cursor, m.index))
      block = { start: m.index!, body: m.index! + m[0].length, tag, depth: 1, attrs }
    }
  }
  if (block) emit(content.length, false)
  else {
    let tail = content.slice(cursor)
    if (streaming) {
      const partial = tail.lastIndexOf('<')
      if (partial >= 0 && !tail.slice(partial).includes('>') && (/^<\/?(?:details|think)\b/i.test(tail.slice(partial)) || ['<details', '<think', '</details', '</think'].some(tag => tag.startsWith(tail.slice(partial).toLowerCase())))) tail = tail.slice(0, partial)
    }
    text(tail)
  }
  return { steps, settled, settledSteps, openReasoning }
}
