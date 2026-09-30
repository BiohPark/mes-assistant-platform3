import { Module } from '@nestjs/common'
import { LlmModule } from '../llm/llm.module.js'
import { RequestsController, ThreadRequestsController } from './requests.controller.js'

@Module({ imports: [LlmModule], controllers: [RequestsController, ThreadRequestsController] })
export class RequestsModule {}
