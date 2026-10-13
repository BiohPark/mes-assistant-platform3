import { Module } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module.js'
import { appSetting } from '../db/schema.js'
import { CONFIG, type AppConfig } from '../config/config.js'
import { LlmController } from './llm.controller.js'
import { LlmAdminController } from './llm-admin.controller.js'
import { LLM_PROVIDER } from './provider.token.js'
import { toLlmSettings } from './presets.js'
import { RequestsService } from '../requests/requests.service.js'
import { SystemAssistantController } from './system-assistant.controller.js'

@Module({
  controllers: [LlmController, LlmAdminController, SystemAssistantController],
  providers: [{ provide: LLM_PROVIDER, inject: [CONFIG, DB], useFactory: (config: AppConfig, db: Db) => RequestsService.createProvider(toLlmSettings(config.llm), async () => {
    const [row] = await db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'owuiTools'))
    return row?.value === 'off' ? 'off' : 'auto'
  }) }, RequestsService],
  exports: [LLM_PROVIDER, RequestsService],
})
export class LlmModule {}
