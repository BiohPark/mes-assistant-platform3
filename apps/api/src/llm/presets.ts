import { DEFAULT_LLM_SETTINGS, type LlmSettings } from '@mes/domain'
import type { AppConfig } from '../config/config.js'

export function toLlmSettings(config: AppConfig['llm']): LlmSettings {
  const baseUrl = config.preset === 'openwebui'
    ? `${config.baseUrl.replace(/\/+$/, '').replace(/\/api$/, '')}/api`
    : config.baseUrl
  return {
    mode: config.mode,
    baseUrl,
    apiKey: config.apiKey,
    model: config.defaultModel ?? DEFAULT_LLM_SETTINGS.model,
    fileDelivery: config.preset === 'openwebui' ? 'openwebui' : 'inline',
  }
}
