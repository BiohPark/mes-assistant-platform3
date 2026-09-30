import { Module } from '@nestjs/common'
import { LlmModule } from '../llm/llm.module.js'
import { ConversationInputsController } from './conversation-inputs.controller.js'
import { DbConversationInputsService } from './conversation-inputs.service.js'

@Module({ imports: [LlmModule], controllers: [ConversationInputsController], providers: [DbConversationInputsService] })
export class ConversationInputsModule {}
