import { DEFAULT_LLM_SETTINGS } from '@mes/domain'
import { eq } from 'drizzle-orm'
import type { AppConfig } from '../config/config.js'
import type { Db } from '../db/db.module.js'
import { appSetting } from '../db/schema.js'

/**
 * 기본 모델의 단일 정본 — .env `LLM_DEFAULT_MODEL` 유효값(공백·미설정이면 도메인 기본값). S7 C2
 * DB `app_setting.defaultModel`은 어디서도 읽지 않는다. 요청 시작·SR 보조·요약·프롬프트 설정·시스템 assistant·진단·시험 API가 모두 이 함수를 쓴다.
 */
export function effectiveDefaultModel(config: Pick<AppConfig, 'llm'>): string {
  return config.llm.defaultModel?.trim() || DEFAULT_LLM_SETTINGS.model
}

/** 기동 시 한 번: 구형 `app_setting.defaultModel` 행이 남아 있으면 경고 1줄. 행은 지우지 않고 무시만 한다 */
export async function warnIgnoredDefaultModelSetting(db: Db, config: Pick<AppConfig, 'llm'>, warn: (line: string) => void): Promise<boolean> {
  const [row] = await db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'defaultModel'))
  if (!row) return false
  warn(`app_setting.defaultModel(${JSON.stringify(row.value)})은 더 이상 쓰이지 않습니다 — 기본 모델은 .env LLM_DEFAULT_MODEL 유효값 "${effectiveDefaultModel(config)}"입니다`)
  return true
}
