import type { OwuiSettings } from '@mes/llm'
import type { AppConfig } from '../config/config.js'
import { effectiveDefaultModel } from './effectiveDefaultModel.js'

export function toLlmSettings(config: Pick<AppConfig['llm'], 'mode' | 'preset' | 'baseUrl' | 'apiKey' | 'defaultModel'>, terminalOptions: Pick<OwuiSettings, 'readOwuiDefaultTerminalId'> = {}): OwuiSettings {
  const baseUrl = config.preset === 'openwebui'
    ? `${config.baseUrl.replace(/\/+$/, '').replace(/\/api$/, '')}/api`
    : config.baseUrl
  return {
    ...terminalOptions,
    mode: config.mode,
    preset: config.preset,
    baseUrl,
    apiKey: config.apiKey,
    model: effectiveDefaultModel({ llm: config }),
    fileDelivery: config.preset === 'openwebui' ? 'openwebui' : 'inline',
  }
}
