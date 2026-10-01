import { Module } from '@nestjs/common'
import { DbTasksService } from '../tasks/tasks.service.js'
import { SrController } from './sr.controller.js'
import { SrService } from './sr.service.js'
import { SrNotificationsService } from './notifications.service.js'
import { LlmModule } from '../llm/llm.module.js'

@Module({ imports: [LlmModule], controllers: [SrController], providers: [DbTasksService, SrService, SrNotificationsService] })
export class SrModule {}
