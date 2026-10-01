import { Module } from '@nestjs/common'
import { AuthModule } from './auth/auth.module.js'
import { ConfigModule } from './config/config.module.js'
import { DbModule } from './db/db.module.js'
import { HealthModule } from './health/health.controller.js'
import { LlmModule } from './llm/llm.module.js'
import { CatalogModule } from './catalog/catalog.module.js'
import { TasksModule } from './tasks/tasks.module.js'
import { FilesModule } from './files/files.module.js'
import { RequestsModule } from './requests/requests.module.js'
import { ConversationInputsModule } from './context/conversation-inputs.module.js'
import { EventsModule } from './events/events.module.js'
import { AdminModule } from './admin/admin.module.js'
import { SrModule } from './sr/sr.module.js'
import { NotificationsModule } from './notifications/notifications.module.js'
import { ReportsModule } from './reports/reports.module.js'

@Module({ imports: [ConfigModule, DbModule, HealthModule, AuthModule, EventsModule, LlmModule, CatalogModule, AdminModule, TasksModule, FilesModule, RequestsModule, ConversationInputsModule, SrModule, NotificationsModule, ReportsModule] })
export class AppModule {}
