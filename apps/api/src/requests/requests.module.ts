import { Module } from '@nestjs/common'
import { LlmModule } from '../llm/llm.module.js'
import { RequestsController, ThreadRequestsController } from './requests.controller.js'
import { SseShutdown } from './sse-shutdown.js'

@Module({ imports: [LlmModule], controllers: [RequestsController, ThreadRequestsController], providers: [SseShutdown] })
export class RequestsModule {}
