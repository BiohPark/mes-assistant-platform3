import { Module } from '@nestjs/common'
import { CONFIG, type AppConfig } from '../config/config.js'
import { LlmController } from './llm.controller.js'
import { LLM_PROVIDER } from './provider.token.js'
import { toLlmSettings } from './presets.js'
import { RequestsService } from '../requests/requests.service.js'
import { SystemAssistantController } from './system-assistant.controller.js'

@Module({
  controllers: [LlmController, SystemAssistantController],
  providers: [{ provide: LLM_PROVIDER, inject: [CONFIG], useFactory: (config: AppConfig) => RequestsService.createProvider(toLlmSettings(config.llm)) }, RequestsService],
  exports: [LLM_PROVIDER, RequestsService],
})
export class LlmModule {}
