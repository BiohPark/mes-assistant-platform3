import { describe, expect, it } from 'vitest'
import { createProvider } from '@mes/llm'
import { loadConfig } from '../config/config.js'
import { toLlmSettings } from './presets.js'

describe('fake OpenWebUI 계약', () => {
  it.each([
    ['openwebui', 'http://localhost:3101'],
    ['openai-compatible', 'http://localhost:3101/api'],
  ] as const)('%s 목록과 ping', async (preset, baseUrl) => {
    const config = loadConfig({ DATABASE_URL: 'postgres://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', LLM_MODE: 'live', LLM_PRESET: preset, LLM_BASE_URL: baseUrl, LLM_API_KEY: 'dev-fake-key' })
    const provider = createProvider(toLlmSettings(config.llm))
    expect(await provider.listModels()).toEqual(['fake-general', 'fake-writer'])
    expect((await provider.ping()).ok).toBe(true)
  })
})
