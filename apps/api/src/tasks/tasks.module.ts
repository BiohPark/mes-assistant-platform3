import { Module } from '@nestjs/common'
import { DbTasksService } from './tasks.service.js'
import { TagsController, TasksController, ThreadsController } from './tasks.controller.js'
import { TaskExtrasService } from './task-extras.service.js'
import { LlmModule } from '../llm/llm.module.js'
import { FilesModule } from '../files/files.module.js'
import { NotificationsModule } from '../notifications/notifications.module.js'

@Module({ imports: [LlmModule, FilesModule, NotificationsModule], controllers: [TasksController, TagsController, ThreadsController], providers: [DbTasksService, TaskExtrasService, { provide: 'TASK_EXTRAS', useExisting: TaskExtrasService }], exports: [DbTasksService] })
export class TasksModule {}
