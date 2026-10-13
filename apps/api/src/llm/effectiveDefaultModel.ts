import { DEFAULT_LLM_SETTINGS } from '@mes/domain'
import { eq } from 'drizzle-orm'
import type { AppConfig } from '../config/config.js'
import type { Db } from '../db/db.module.js'
import { appSetting } from '../db/schema.js'

type ModelConfig = { llm: Pick<AppConfig['llm'], 'defaultModel'> }
export const DEFAULT_MODEL_OVERRIDE_KEY = 'defaultModelOverride'

/**
 * 기본 모델의 단일 정본: DB defaultModelOverride → .env LLM_DEFAULT_MODEL → 도메인 기본값.
 * 구형 DB defaultModel은 무시한다. 요청 시작·SR 보조·요약·프롬프트 설정·시스템 assistant·진단·시험 API·체크리스트 점검(task-extras)이 모두 이 해석을 쓴다.
 * DB 값은 캐시하지 않는다. 설정 변경·해제 후 다음 호출부터 반영하며, 대화·에이전트에 명시한 모델은 소비처에서 우선한다.
 */
export function resolveDefaultModel(config: ModelConfig, override?: unknown): { model: string; source: 'setting' | 'env' | 'default' } {
  const setting = typeof override === 'string' ? override.trim() : ''
  if (setting.length >= 1 && setting.length <= 191) return { model: setting, source: 'setting' }
  const env = config.llm.defaultModel?.trim()
  return env ? { model: env, source: 'env' } : { model: DEFAULT_LLM_SETTINGS.model, source: 'default' }
}

export function effectiveDefaultModel(config: ModelConfig, override?: unknown): string {
  return resolveDefaultModel(config, override).model
}

/** 현재 DB 값을 읽는 소비처용 함수. 트랜잭션에서도 같은 해석을 사용한다. */
export async function readEffectiveDefaultModel(db: Db, config: ModelConfig): Promise<string> {
  const [row] = await db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, DEFAULT_MODEL_OVERRIDE_KEY))
  return effectiveDefaultModel(config, row?.value)
}

/** 기동 시 한 번: 구형 행은 지우지 않고 무시하며 경고 1줄을 남긴다. */
export async function warnIgnoredDefaultModelSetting(db: Db, config: Pick<AppConfig, 'llm'>, warn: (line: string) => void): Promise<boolean> {
  const [row] = await db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'defaultModel'))
  if (!row) return false
  warn(`app_setting.defaultModel(${JSON.stringify(row.value)})은 더 이상 쓰이지 않습니다 — 전역 설정 defaultModelOverride를 사용하세요. 폴백은 .env LLM_DEFAULT_MODEL 유효값 "${effectiveDefaultModel(config)}"입니다`)
  return true
}
