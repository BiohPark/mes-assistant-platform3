import { describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../config/config.js'
import { effectiveDefaultModel, warnIgnoredDefaultModelSetting } from './effectiveDefaultModel.js'

const base = { DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' }
const db = (rows: unknown[]) => ({ select: () => ({ from: () => ({ where: async () => rows }) }) }) as never

describe('effectiveDefaultModel (S7 C2)', () => {
  it('.env LLM_DEFAULT_MODEL 유효값이 정본이고, 없거나 공백이면 도메인 기본값', () => {
    expect(effectiveDefaultModel(loadConfig(base))).toBe('glm-5.2')
    expect(effectiveDefaultModel(loadConfig({ ...base, LLM_DEFAULT_MODEL: '   ' }))).toBe('glm-5.2')
    expect(effectiveDefaultModel(loadConfig({ ...base, LLM_DEFAULT_MODEL: ' env-model ' }))).toBe('env-model')
  })

  it('구형 app_setting.defaultModel 행은 무시하고 기동 경고 1줄만 남긴다 — 행이 없으면 조용하다', async () => {
    const warn = vi.fn<(line: string) => void>()
    expect(await warnIgnoredDefaultModelSetting(db([]), loadConfig({ ...base, LLM_DEFAULT_MODEL: 'env-model' }), warn)).toBe(false)
    expect(warn).not.toHaveBeenCalled()
    expect(await warnIgnoredDefaultModelSetting(db([{ value: 'db-model' }]), loadConfig({ ...base, LLM_DEFAULT_MODEL: 'env-model' }), warn)).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    const line = warn.mock.calls[0]![0]
    expect(line).not.toContain('\n')
    expect(line).toContain('db-model')
    expect(line).toContain('env-model')
    expect(line).toContain('LLM_DEFAULT_MODEL')
  })
})
