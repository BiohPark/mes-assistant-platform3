import { Module } from '@nestjs/common'
import { TasksModule } from '../tasks/tasks.module.js'
import { SrController } from './sr.controller.js'
import { SrService } from './sr.service.js'
import { NotificationsModule } from '../notifications/notifications.module.js'
import { LlmModule } from '../llm/llm.module.js'

@Module({ imports: [LlmModule, TasksModule, NotificationsModule], controllers: [SrController], providers: [SrService] })
export class SrModule {}
