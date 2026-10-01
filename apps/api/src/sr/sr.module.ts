import { Module } from '@nestjs/common'
import { TasksModule } from '../tasks/tasks.module.js'
import { SrController } from './sr.controller.js'
import { SrService } from './sr.service.js'
import { SrNotificationsService } from './notifications.service.js'
import { LlmModule } from '../llm/llm.module.js'

@Module({ imports: [LlmModule, TasksModule], controllers: [SrController], providers: [SrService, SrNotificationsService] })
export class SrModule {}
