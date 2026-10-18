import { describe, expect, it } from 'vitest'
import { boundStepPayload, boundSteps, publicSteps, renderAnswer, stepProjection, STEP_PAYLOAD_MAX_BYTES, STEPS_PAYLOAD_TOTAL_MAX_BYTES } from './answerSteps.js'
import type { AnswerStep } from './answerSteps.js'
const steps: AnswerStep[] = [
  { type: 'reasoning', text: '검토' }, { type: 'text', text: '먼저' },
  { type: 'tool', name: 'lookup', input: '{"q":"원문"}', output: '조회 결과', status: 'done' },
  { type: 'code', code: 'print(1)', output: '1', status: 'done' }, { type: 'text', text: '나중' },
]
describe('answer steps', () => {
  it('projects legacy text and reasoning in original order', () => {
    expect(stepProjection(steps)).toEqual({ content: '먼저\n나중', reasoning: '검토' })
  })
  it('renders the same ordered detail for copy and conversation attachments', () => {
    const message = { content: 'legacy', reasoning: 'old', steps }
    expect(renderAnswer(message, 'brief')).toBe('[생각 과정]\n검토\n\n먼저\n\n나중')
    const full = renderAnswer(message, 'full')
    expect(full).toContain('{"q":"원문"}')
    expect(full.indexOf('먼저')).toBeLessThan(full.indexOf('lookup'))
    expect(full.indexOf('조회 결과')).toBeLessThan(full.indexOf('print(1)'))
    expect(full.indexOf('print(1)')).toBeLessThan(full.indexOf('나중'))
    expect(renderAnswer({ content: '옛 답변', reasoning: '옛 생각' }, 'brief')).toContain('옛 답변')
  })
  it('preserves complete raw payloads up to 64 KiB and stores only byte length above it', () => {
    expect(STEP_PAYLOAD_MAX_BYTES).toBe(65_536)
    const raw = '한'.repeat(21_845)
    expect(boundStepPayload(raw)).toBe(raw)
    expect(boundStepPayload(raw + '글')).toEqual({ bytes: 65_538 })
  })
  it('removes the private originalText from steps shown outside the server', () => {
    const own: AnswerStep[] = [{ type: 'text', text: '표시', originalText: '원문' }, steps[2]!]
    expect(publicSteps(own)).toEqual([{ type: 'text', text: '표시' }, steps[2]])
    expect(JSON.stringify(publicSteps(own))).not.toContain('originalText')
    expect(publicSteps(null)).toBeNull()
  })
  it('caps the total tool payload per message in order, keeping only byte length after the cap and never touching text', () => {
    const big = 'x'.repeat(STEP_PAYLOAD_MAX_BYTES)
    const many: AnswerStep[] = Array.from({ length: STEPS_PAYLOAD_TOTAL_MAX_BYTES / STEP_PAYLOAD_MAX_BYTES + 2 }, (_, i) =>
      ({ type: 'tool', name: `t${i}`, input: '', output: big, status: 'done' }))
    const text: AnswerStep = { type: 'text', text: big + big }
    const bounded = boundSteps([...many, text])
    expect(bounded.slice(0, STEPS_PAYLOAD_TOTAL_MAX_BYTES / STEP_PAYLOAD_MAX_BYTES).every(s => s.type === 'tool' && s.output === big)).toBe(true)
    expect(bounded.at(-2)).toMatchObject({ output: { bytes: STEP_PAYLOAD_MAX_BYTES } })
    expect(bounded.at(-1)).toBe(text)
    expect(boundSteps(bounded)).toEqual(bounded)
    expect(boundSteps(steps)).toBe(steps)
  })
  it('labels sources apart from tools and supports translated labels for the clipboard', () => {
    const source: AnswerStep = { type: 'tool', name: 'kb', input: '', output: '출처 원문', status: 'done', source: true }
    expect(renderAnswer({ content: '', steps: [source] }, 'full')).toContain('[참고 출처: kb]')
    expect(renderAnswer({ content: '', steps: [source] }, 'brief')).toBe('')
    expect(renderAnswer({ content: '', steps }, 'brief', { reasoning: 'Thinking process' })).toContain('[Thinking process]\n검토')
  })
})
