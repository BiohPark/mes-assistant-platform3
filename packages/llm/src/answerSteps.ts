import { contentSteps } from './contentSteps.js'
import { boundStepPayload, type AnswerStep } from '@mes/domain'
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const parts = (v: unknown) => Array.isArray(v) ? v.map(p => object(p) && typeof p.text === 'string' ? p.text : '').join('') : ''
const raw = (v: unknown): string => typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v)
// Unwrap only plain text parts. Mixed outputs retain their entire structured value.
const resultText = (v: unknown): string => Array.isArray(v) && v.every(p => object(p) && typeof p.text === 'string' && Object.keys(p).every(key => key === 'type' || key === 'text')) ? parts(v) : raw(v)
const status = (v: unknown, done: boolean): 'running' | 'done' | 'error' => v === 'failed' || v === 'error' ? 'error' : done || v === 'completed' || v === 'done' || v === 'success' ? 'done' : 'running'
/** Output is cumulative. Traverse the whole array so short-lived calls between polls survive. */
export function sessionSteps(message: Record<string, unknown>): AnswerStep[] {
  const output = Array.isArray(message.output) ? message.output.filter(object) : []
  const steps: AnswerStep[] = []
  for (const item of output) {
    if (item.type === 'message') {
      const text = parts(item.content)
      if (text.trim()) steps.push({ type: 'text', text })
    } else if (item.type === 'reasoning') {
      const text = parts(item.content) || parts(item.summary)
      if (text) steps.push({ type: 'reasoning', text })
    } else if (item.type === 'function_call') {
      const result = output.find(o => o.type === 'function_call_output' && o.call_id === item.call_id)
      steps.push({ type: 'tool', name: typeof item.name === 'string' ? item.name : '?',
        input: boundStepPayload(raw(item.arguments)), output: boundStepPayload(result ? resultText(result.output) : ''),
        status: status(result?.status ?? item.status, !!result || message.done === true) })
    } else if (item.type === 'open_webui:code_interpreter') {
      steps.push({ type: 'code', code: boundStepPayload(raw(item.code)), output: boundStepPayload(resultText(item.output)), status: status(item.status, message.done === true) })
    }
  }
  if (typeof message.content === 'string' && message.content) {
    const parsed = contentSteps(message.content)
    // output[] wins; content is only a fallback for answer text when output has no message.
    // Exception: content wrappers carrying more reasoning/tool/code steps than output means output is partial or late
    // (older OWUI serializes every block into content). Then content is the ordered source, so a late output item
    // never takes an earlier index (overwriting the intro text) nor drops content-only reasoning.
    const extra = (list: AnswerStep[]) => list.filter(s => s.type !== 'text').length
    if (!steps.length || extra(parsed) > extra(steps)) return parsed
    if (!steps.some(s => s.type === 'text')) steps.push(...parsed.filter(s => s.type === 'text'))
  }
  return steps
}
