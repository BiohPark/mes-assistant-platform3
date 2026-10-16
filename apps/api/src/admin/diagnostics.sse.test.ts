import 'reflect-metadata'
import { EventEmitter } from 'node:events'
import type { Response } from 'express'
import { expect, it, vi } from 'vitest'
import { DiagnosticsController, SSE_PROBE_EVENTS, SSE_PROBE_GAP_MS } from './diagnostics.controller.js'
import type { DiagnosticsService } from './diagnostics.service.js'

it('streams evenly spaced pings with their send offsets, then ends (SSE check)', () => {
  vi.useFakeTimers()
  try {
    const writes: string[] = []
    const headers: Record<string, string>[] = []
    const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false,
      status() { return this }, set(value: Record<string, string>) { headers.push(value); return this }, flushHeaders() {},
      write(chunk: string) { writes.push(chunk); return true }, end() { this.writableEnded = true } })
    new DiagnosticsController({} as DiagnosticsService).sse(res as unknown as Response)
    expect(headers[0]).toMatchObject({ 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' })
    expect(writes).toHaveLength(1)
    vi.advanceTimersByTime(SSE_PROBE_GAP_MS * SSE_PROBE_EVENTS)
    expect(writes.map((chunk) => JSON.parse(chunk.split('data: ')[1]!))).toEqual(Array.from({ length: SSE_PROBE_EVENTS }, (_, seq) => ({ seq, sentAt: seq * SSE_PROBE_GAP_MS })))
    expect(writes.every((chunk) => chunk.startsWith('event: ping\n'))).toBe(true)
    expect(res.writableEnded).toBe(true)
  } finally { vi.useRealTimers() }
})
