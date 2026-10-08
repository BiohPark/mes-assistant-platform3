import type { LlmSettings } from '@mes/domain'
import type { AppConfig } from '../config/config.js'
import { effectiveDefaultModel } from './effectiveDefaultModel.js'

export function toLlmSettings(config: AppConfig['llm']): LlmSettings {
  const baseUrl = config.preset === 'openwebui'
    ? `${config.baseUrl.replace(/\/+$/, '').replace(/\/api$/, '')}/api`
    : config.baseUrl
  return {
    mode: config.mode,
    baseUrl,
    apiKey: config.apiKey,
    model: effectiveDefaultModel({ llm: config }),
    fileDelivery: config.preset === 'openwebui' ? 'openwebui' : 'inline',
  }
}
