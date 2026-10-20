import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnswerStep } from '@mes/domain'
import { directMarkup, directPieces, sessionFrames, type SessionFrame } from '../../../docker/fake-openwebui/progressive.mjs'
import { parseContent } from './contentSteps.js'
import { sessionSteps } from './answerSteps.js'
import { OpenAICompatibleProvider } from './openaiProvider.js'
import type { ChatChunk, ChatRequest } from './provider.js'

// S16 — 실제 OpenWebUI처럼 점진 직렬화되는 답변(docker/fake-openwebui/progressive.mjs)을 단계로 받는 동안
// 어느 순간에도 앞 단계가 다른 단계로 덮이거나 다음 단계 글이 앞 단계에 붙지 않아야 한다.
afterEach(() => { vi.unstubAllGlobals() })

/** 중간 상태 = 최종 단계의 앞부분: 같은 순서·종류, 자라는 마지막 단계만 덜 찼고, 앞 단계는 (끝 공백 말고) 끝난 모양 */
export function expectPrefixOf(current: AnswerStep[], final: AnswerStep[], at: string) {
  expect(current.length, at).toBeLessThanOrEqual(final.length)
  current.forEach((step, i) => {
    const end = final[i]!
    const where = `${at} · step ${i}`
    expect(step.type, where).toBe(end.type)
    const last = i === current.length - 1
    if ((step.type === 'text' || step.type === 'reasoning') && (end.type === 'text' || end.type === 'reasoning')) {
      expect(end.text.startsWith(step.text), `${where}: ${JSON.stringify(step.text)} ⊄ ${JSON.stringify(end.text)}`).toBe(true)
      if (!last) expect(step.text.trimEnd(), where).toBe(end.text.trimEnd())
    } else if (step.type === 'code' && end.type === 'code') {
      expect(String(end.code).startsWith(String(step.code)), `${where}: ${JSON.stringify(step.code)}`).toBe(true)
      expect(String(end.output).startsWith(String(step.output)), where).toBe(true)
    } else if (step.type === 'tool' && end.type === 'tool') expect(step.name, where).toBe(end.name)
  })
}

/** onStep 계약(index·step·count, count가 줄면 잘라냄)을 그대로 따른 거울 — 매 호출 뒤 check */
function mirror(check: (steps: AnswerStep[], call: number) => void) {
  const steps: AnswerStep[] = []
  let calls = 0
  const onStep: NonNullable<ChatRequest['onStep']> = (index, step, count) => {
    steps[index] = step
    if (count !== undefined && count < steps.length) steps.length = count
    check([...steps], ++calls)
  }
  return { steps, onStep }
}

describe('direct SSE — 4~16자 조각(태그·엔티티·펜스 중간에서 끊김)', () => {
  it('keeps every intermediate step list a prefix of the final parse and never replaces reasoning or text', async () => {
    const final = parseContent(directMarkup()).steps
    expect(final.map(s => s.type)).toEqual(['text', 'reasoning', 'text', 'code', 'text', 'tool', 'text'])
    const frames = [...directPieces().map(text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`), 'data: [DONE]\n\n']
    vi.stubGlobal('fetch', vi.fn(async () => new Response(frames.join(''), { headers: { 'content-type': 'text/event-stream' } })))
    const view = mirror((steps, call) => expectPrefixOf(steps, final, `onStep #${call}`))
    const chunks: ChatChunk[] = []
    for await (const chunk of new OpenAICompatibleProvider({ mode: 'live', baseUrl: 'https://u.example/v1', apiKey: 'k', model: 'm' })
      .stream({ model: 'm', messages: [], onStep: view.onStep })) chunks.push(chunk)
    expect(view.steps).toEqual(final)
    // 잘린 '<s'(summary)·'&g'(&gt;)·'```py'가 잠깐 보였다가 사라지면 replace가 난다 — 받은 글은 이어 붙기만 해야 한다
    expect(chunks.filter(c => c.type === 'replace')).toEqual([])
  })

  it('a second tool round reusing index 0 with a new id becomes a new step, not more arguments for the first call', async () => {
    const call = (id: string, name: string, args: string) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args } }] } }] })
    const more = (args: string) => ({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }] })
    const frames = [call('a', 'first', '{"q"'), more(':1}'), { choices: [{ delta: { content: '중간 글' } }] }, call('b', 'second', '{"q":2}')]
    vi.stubGlobal('fetch', vi.fn(async () => new Response([...frames.map(f => `data: ${JSON.stringify(f)}\n\n`), 'data: [DONE]\n\n'].join(''), { headers: { 'content-type': 'text/event-stream' } })))
    const view = mirror(() => undefined)
    const chunks: ChatChunk[] = []
    for await (const chunk of new OpenAICompatibleProvider({ mode: 'live', baseUrl: 'https://u.example/v1', apiKey: 'k', model: 'm' })
      .stream({ model: 'm', messages: [], onStep: view.onStep })) chunks.push(chunk)
    expect(view.steps).toEqual([
      { type: 'tool', name: 'first', input: '{"q":1}', output: '', status: 'done' }, { type: 'text', text: '중간 글' },
      { type: 'tool', name: 'second', input: '{"q":2}', output: '', status: 'done' }])
    expect(chunks.filter(c => c.type === 'tool_call')).toEqual([
      { type: 'tool_call', call: { id: 'a', name: 'first', arguments: '{"q":1}' } }, { type: 'tool_call', call: { id: 'b', name: 'second', arguments: '{"q":2}' } }])
  })
})

describe('session polling — content가 폴링마다 다시 직렬화되고 output[]은 비었거나 늦게·일부만 채워짐', () => {
  const settings = { mode: 'live' as const, preset: 'openwebui' as const, baseUrl: 'https://owui.example/api', apiKey: 'k', model: 'm' }
  function upstream(frames: SessionFrame[]) {
    let polls = 0, id = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname
      if (path === '/api/models') return new Response(JSON.stringify({ data: [{ id: 'm' }] }))
      if (path === '/api/chat/completions') { id = String(JSON.parse(String(init.body)).id); return new Response(JSON.stringify({ status: true, chat_id: 'c1' })) }
      if (path === '/api/v1/chats/c1' && (init.method ?? 'GET') === 'GET') {
        const index = Math.min(polls++, frames.length - 1)
        const message = { id, role: 'assistant', ...frames[index], done: index === frames.length - 1 }
        return new Response(JSON.stringify({ chat: { history: { messages: { [id]: message } } } }))
      }
      return new Response('{"status":true}')
    }))
  }
  for (const output of ['empty', 'tools', 'late'] as const) {
    it(`output ${output}: steps keep order and count at every poll, and the final steps equal the final parse`, async () => {
      const frames = sessionFrames(output)
      const final = sessionSteps({ ...frames.at(-1)!, done: true })
      expect(final.map(s => s.type)).toEqual(['text', 'reasoning', 'text', 'code', 'text', 'tool', 'text'])
      // 'late'는 마지막 폴링에서 구조화된 output으로 바뀐다(직렬화 줄바꿈만 다름) — 그 전까지는 content 최종 파싱의 앞부분이다
      // 그 폴링 안의 단계별 onStep 사이에는 두 모양이 섞이므로 'late'만 글 앞뒤 공백을 무시한다
      const trim = (steps: AnswerStep[]) => output === 'late' ? steps.map(s => s.type === 'text' || s.type === 'reasoning' ? { ...s, text: s.text.trim() } : s) : steps
      const reference = trim(output === 'late' ? sessionSteps({ content: frames.at(-1)!.content }) : final)
      let seen = 0
      const view = mirror((steps, call) => {
        if (steps.length === final.length && JSON.stringify(steps) === JSON.stringify(final)) return
        seen++
        expectPrefixOf(trim(steps), reference, `${output} onStep #${call}`)
      })
      upstream(frames)
      for await (const chunk of new OpenAICompatibleProvider(settings, undefined, { sessionPollMs: 1 }).stream({ model: 'm', messages: [], owuiMode: 'session', onStep: view.onStep })) void chunk
      expect(seen).toBeGreaterThan(frames.length / 2)
      expect(view.steps).toEqual(final)
    })
  }
})
