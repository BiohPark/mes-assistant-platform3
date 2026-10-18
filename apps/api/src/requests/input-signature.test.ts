import { describe, expect, it } from 'vitest'
import type { BuiltRequest } from '@mes/llm'
import { inputSignature } from './input-signature.js'

const preview = () => ({ model: 'glm-5.2', messages: [{ role: 'user' as const, content: '104.25' }],
  info: { at: '2026-10-19T00:00:00Z', provider: 'mock' as const, transport: 'inline' as 'inline' | 'openwebui', model: 'glm-5.2', bytes: 1080, limitBytes: 65536,
    inputs: [{ kind: 'sr' as const, srId: 'sr-a', code: 'SR-1', title: 'Pump', weight: 'reference' as 'main' | 'reference', bytes: 6 }], srCodes: [], srs: [] },
}) satisfies Pick<BuiltRequest, 'model' | 'messages' | 'info'>

describe('estimated input signature', () => {
  it('is stable across estimate timestamps', () => {
    const before = preview(), after = preview()
    after.info.at = '2026-10-19T01:00:00Z'
    expect(inputSignature('actor', 'thread', undefined, before)).toMatch(/^[a-f0-9]{64}$/)
    expect(inputSignature('actor', 'thread', undefined, after)).toBe(inputSignature('actor', 'thread', undefined, before))
  })
  it.each(['content', 'selection', 'weight', 'model', 'transport', 'bytes', 'limit'] as const)('detects changed %s in the estimated request', change => {
    const before = preview(), after = preview()
    if (change === 'content') after.messages[0]!.content = '107.50'
    if (change === 'selection') after.info.inputs[0]!.srId = 'sr-b'
    if (change === 'weight') after.info.inputs[0]!.weight = 'main'
    if (change === 'model') after.model = 'glm-5.1'
    if (change === 'transport') after.info.transport = 'openwebui'
    if (change === 'bytes') after.info.bytes = 1075
    if (change === 'limit') after.info.limitBytes = 32768
    expect(inputSignature('actor', 'thread', undefined, after)).not.toBe(inputSignature('actor', 'thread', undefined, before))
  })
  it('binds the signature to actor, thread and answer detail', () => {
    const original = inputSignature('actor', 'thread', undefined, preview())
    expect(inputSignature('other', 'thread', undefined, preview())).not.toBe(original)
    expect(inputSignature('actor', 'other', undefined, preview())).not.toBe(original)
    expect(inputSignature('actor', 'thread', 'full', preview())).not.toBe(original)
    expect(inputSignature('actor', 'thread', 'brief', preview())).toBe(original)
  })
})
