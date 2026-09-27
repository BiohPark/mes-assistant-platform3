import { describe, it, expect } from 'vitest'
import { resolveModel } from './modelResolution.js'

describe('resolveModel', () => {
  const settings = { model: 'glm-5.2' }
  it('thread > task > assistant mapping > settings', () => {
    expect(resolveModel({ thread: { modelId: 'th' }, task: { modelId: 'tk' }, assistant: { modelId: 'as' }, settings })).toEqual({ modelId: 'th', source: 'thread' })
    expect(resolveModel({ thread: { modelId: '' }, task: { modelId: 'tk' }, assistant: { modelId: 'as' }, settings })).toEqual({ modelId: 'tk', source: 'task' })
    expect(resolveModel({ task: { modelId: '' }, assistant: { modelId: 'as' }, settings })).toEqual({ modelId: 'as', source: 'assistant' })
    expect(resolveModel({ settings })).toEqual({ modelId: 'glm-5.2', source: 'settings' })
  })
  it('unmapped assistant falls back to the common default model', () => {
    expect(resolveModel({ assistant: { modelId: '' }, settings })).toEqual({ modelId: 'glm-5.2', source: 'settings' })
    expect(resolveModel({ assistant: {}, settings })).toEqual({ modelId: 'glm-5.2', source: 'settings' })
  })
})
