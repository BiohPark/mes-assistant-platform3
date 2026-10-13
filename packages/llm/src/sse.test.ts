import { describe, it, expect } from 'vitest'
import { parseSseLines, extractDelta, ThinkSplitter } from './sse.js'

describe('parseSseLines', () => {
  it('splits buffered text into complete data payloads and returns remainder', () => {
    const { events, rest } = parseSseLines('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"')
    expect(events).toEqual(['{"a":1}', '{"b":2}'])
    expect(rest).toBe('data: {"c"')
  })

  it('handles CRLF and comment lines', () => {
    const { events } = parseSseLines(': keep-alive\r\ndata: x\r\n\r\n')
    expect(events).toEqual(['x'])
  })
})

describe('extractDelta', () => {
  it('reads content delta from OpenAI chunk', () => {
    const chunk = { choices: [{ delta: { content: '안녕' } }] }
    expect(extractDelta(chunk)).toEqual({ text: '안녕', reasoning: '', toolCalls: [] })
  })

  it('accumulates tool call fragments by index', () => {
    const chunk = {
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'create_task', arguments: '{"ti' } }] } }],
    }
    expect(extractDelta(chunk).toolCalls).toEqual([{ index: 0, id: 'c1', name: 'create_task', arguments: '{"ti' }])
  })

  it('returns empty for malformed chunk', () => {
    expect(extractDelta({})).toEqual({ text: '', reasoning: '', toolCalls: [] })
  })
})

it('extracts either reasoning field and ignores nonstandard frames safely', () => {
  expect(extractDelta({ choices: [{ delta: { reasoning_content: '생각', content: '답' } }] })).toMatchObject({ reasoning: '생각', text: '답' })
  expect(extractDelta({ choices: [{ delta: { reasoning: '검토' } }] })).toMatchObject({ reasoning: '검토' })
  for (const frame of [{ sources: [] }, { choices: [null] }, { choices: [1] }, { choices: [{ delta: { content: [], reasoning: {}, tool_calls: [null, 1] } }] }]) {
    expect(extractDelta(frame)).toEqual({ text: '', reasoning: '', toolCalls: [] })
  }
})

it('separates think tags at every possible chunk boundary, including single characters', () => {
  const text = '앞<think>검토\n내용</think>답<think>다시</think>끝'
  for (const pieces of [...Array.from({ length: text.length + 1 }, (_, i) => [text.slice(0, i), text.slice(i)]), [...text]]) {
    const splitter = new ThinkSplitter()
    const chunks = [...pieces.flatMap(piece => splitter.push(piece)), ...splitter.finish()]
    expect(chunks.filter(c => c.type === 'delta').map(c => c.text).join('')).toBe('앞답끝')
    expect(chunks.filter(c => c.type === 'reasoning').map(c => c.text).join('')).toBe('검토\n내용다시')
  }
})

it('preserves ordinary angle brackets and flushes unfinished text in its current channel', () => {
  const splitter = new ThinkSplitter()
  expect([...splitter.push('x < 3 <thi'), ...splitter.finish()]).toEqual([{ type: 'delta', text: 'x < 3 ' }, { type: 'delta', text: '<thi' }])
  const thinking = new ThinkSplitter()
  expect([...thinking.push('<think>진행</thi'), ...thinking.finish()]).toEqual([{ type: 'reasoning', text: '진행' }, { type: 'reasoning', text: '</thi' }])
})
