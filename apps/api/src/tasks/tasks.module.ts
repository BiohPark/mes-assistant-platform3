import { Module } from '@nestjs/common'
import { DbTasksService } from './tasks.service.js'
import { TagsController, TasksController, ThreadsController } from './tasks.controller.js'

@Module({ controllers: [TasksController, TagsController, ThreadsController], providers: [DbTasksService] })
export class TasksModule {}
