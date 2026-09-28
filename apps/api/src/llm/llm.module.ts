import { Module } from '@nestjs/common'
import { createProvider } from '@mes/llm'
import { CONFIG, type AppConfig } from '../config/config.js'
import { LlmController, LLM_PROVIDER } from './llm.controller.js'
import { toLlmSettings } from './presets.js'

@Module({
  controllers: [LlmController],
  providers: [{ provide: LLM_PROVIDER, inject: [CONFIG], useFactory: (config: AppConfig) => createProvider(toLlmSettings(config.llm)) }],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
