import { SrInputsService } from './sr-inputs.service.js'
import { Module } from '@nestjs/common'
import { DbTasksService } from './tasks.service.js'
import { SrInputsController, TagsController, TasksController, ThreadsController } from './tasks.controller.js'
import { TaskExtrasService } from './task-extras.service.js'
import { TaskBriefService } from './task-brief.service.js'
import { LlmModule } from '../llm/llm.module.js'
import { FilesModule } from '../files/files.module.js'
import { NotificationsModule } from '../notifications/notifications.module.js'

@Module({ imports: [LlmModule, FilesModule, NotificationsModule], controllers: [SrInputsController, TasksController, TagsController, ThreadsController], providers: [SrInputsService, DbTasksService, TaskExtrasService, TaskBriefService, { provide: 'TASK_EXTRAS', useExisting: TaskExtrasService }], exports: [DbTasksService] })
export class TasksModule {}
