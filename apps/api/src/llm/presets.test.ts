import { describe, expect, it } from 'vitest'
import { toLlmSettings } from './presets.js'

describe('LLM 프리셋', () => {
  it('OpenWebUI origin에는 /api를 한번만 붙이고 Files API를 사용한다', () => {
    expect(toLlmSettings({ mode: 'live', preset: 'openwebui', baseUrl: 'http://localhost:3101///', apiKey: 'key', defaultModel: undefined })).toEqual({ mode: 'live', baseUrl: 'http://localhost:3101/api', apiKey: 'key', model: 'glm-5.2', fileDelivery: 'openwebui' })
  })
  it('OpenAI 호환 base는 유지하고 파일을 본문으로 전달한다', () => {
    expect(toLlmSettings({ mode: 'live', preset: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: 'key', defaultModel: 'gpt-test' })).toEqual({ mode: 'live', baseUrl: 'https://api.openai.com/v1', apiKey: 'key', model: 'gpt-test', fileDelivery: 'inline' })
  })
})
