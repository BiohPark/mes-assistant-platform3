import { Module } from '@nestjs/common'
import { TasksModule } from '../tasks/tasks.module.js'
import { ReportsController } from './reports.controller.js'
import { ReportsService } from './reports.service.js'

@Module({ imports: [TasksModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
