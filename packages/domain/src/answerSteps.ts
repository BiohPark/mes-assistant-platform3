/** Raw tool payloads are retained whole; oversized values retain their byte count only. */
export const STEP_PAYLOAD_MAX_BYTES = 65_536
/** Per-message total of tool/code payloads. Payloads after the total keep their byte count only; text is never cut. */
export const STEPS_PAYLOAD_TOTAL_MAX_BYTES = 524_288
export type StepPayload = string | { bytes: number }
export type AnswerDetail = 'full' | 'brief'
export type AnswerStep =
  | { type: 'reasoning'; text: string }
  | { type: 'text'; text: string; originalText?: string }
  /** source: OpenWebUI `sources` (retrieved references), shown apart from tool calls */
  | { type: 'tool'; name: string; input: StepPayload; output: StepPayload; status: 'running' | 'done' | 'error'; source?: true }
  | { type: 'code'; code: StepPayload; output: StepPayload; status: 'running' | 'done' | 'error' }

const encoder = new TextEncoder()
const bytesOf = (value: string) => encoder.encode(value).byteLength
export function boundStepPayload(value: string): StepPayload {
  const bytes = bytesOf(value)
  return bytes <= STEP_PAYLOAD_MAX_BYTES ? value : { bytes }
}
/** Applies the per-message total in step order. Unchanged steps (and an unchanged array) keep their identity. */
export function boundSteps(steps: AnswerStep[]): AnswerStep[] {
  let total = 0, changed = false
  const keep = (value: StepPayload): StepPayload => {
    if (typeof value !== 'string') return value
    const bytes = bytesOf(value)
    if (total + bytes <= STEPS_PAYLOAD_TOTAL_MAX_BYTES) { total += bytes; return value }
    total = STEPS_PAYLOAD_TOTAL_MAX_BYTES
    return { bytes }
  }
  const bounded = steps.map(step => {
    if (step.type === 'tool') {
      const input = keep(step.input), output = keep(step.output)
      if (input === step.input && output === step.output) return step
      changed = true
      return { ...step, input, output }
    }
    if (step.type === 'code') {
      const code = keep(step.code), output = keep(step.output)
      if (code === step.code && output === step.output) return step
      changed = true
      return { ...step, code, output }
    }
    return step
  })
  return changed ? bounded : steps
}
export function payloadText(value: StepPayload): string {
  return typeof value === 'string' ? value : `[${value.bytes} bytes — 저장 상한 초과]`
}
/** Steps as shown outside the server: the pre-rewrite originalText stays private (it is only for AI resends). */
export function publicSteps<T extends AnswerStep[] | null | undefined>(steps: T): T {
  if (!steps) return steps
  return steps.map(step => {
    if (step.type !== 'text' || step.originalText === undefined) return step
    const { originalText: _originalText, ...visible } = step
    return visible
  }) as T
}
export function stepProjection(steps: AnswerStep[]): { content: string; reasoning: string } {
  return { content: steps.filter(s => s.type === 'text').map(s => s.text).join('\n'),
    reasoning: steps.filter(s => s.type === 'reasoning').map(s => s.text).join('\n') }
}
export function answerSteps(message: { content: string; reasoning?: string | null; steps?: AnswerStep[] | null }): AnswerStep[] {
  return message.steps?.length ? message.steps : [
    ...(message.reasoning ? [{ type: 'reasoning' as const, text: message.reasoning }] : []),
    ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
  ]
}
/** Block labels. The prompt keeps the Korean defaults; the clipboard passes the viewer's language. */
export interface AnswerLabels { reasoning: string; tool: string; source: string; code: string; input: string; output: string }
const KO_LABELS: AnswerLabels = { reasoning: '생각 과정', tool: '도구 사용', source: '참고 출처', code: '코드 실행', input: '입력', output: '결과' }
/** Shared verbatim rendering for clipboard and reference conversations (D75: 'brief' = reasoning + answer text, tools hidden). */
export function renderAnswer(message: Parameters<typeof answerSteps>[0], detail: AnswerDetail = 'brief', labels: Partial<AnswerLabels> = {}): string {
  const l = { ...KO_LABELS, ...labels }
  return answerSteps(message).flatMap(step => {
    if (step.type === 'text') return [step.text]
    if (step.type === 'reasoning') return [`[${l.reasoning}]\n${step.text}`]
    if (detail === 'brief') return []
    if (step.type === 'tool' && step.source) return [`[${l.source}: ${step.name}]\n${payloadText(step.output)}`]
    if (step.type === 'tool') return [`[${l.tool}: ${step.name} · ${step.status}]\n${l.input}:\n${payloadText(step.input)}\n${l.output}:\n${payloadText(step.output)}`]
    return [`[${l.code} · ${step.status}]\n${payloadText(step.code)}\n${l.output}:\n${payloadText(step.output)}`]
  }).join('\n\n')
}
