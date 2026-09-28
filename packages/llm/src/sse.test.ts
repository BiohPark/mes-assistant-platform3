import { describe, it, expect } from 'vitest'
import { parseSseLines, extractDelta } from './sse.js'

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
    expect(extractDelta(chunk)).toEqual({ text: '안녕', toolCalls: [] })
  })

  it('accumulates tool call fragments by index', () => {
    const chunk = {
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'create_task', arguments: '{"ti' } }] } }],
    }
    expect(extractDelta(chunk).toolCalls).toEqual([{ index: 0, id: 'c1', name: 'create_task', arguments: '{"ti' }])
  })

  it('returns empty for malformed chunk', () => {
    expect(extractDelta({})).toEqual({ text: '', toolCalls: [] })
  })
})
