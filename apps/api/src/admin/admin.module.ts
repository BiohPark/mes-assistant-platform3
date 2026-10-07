import { Module } from '@nestjs/common'
import { AdminAssistantsController, AdminCodesController, AdminSettingsController } from './admin.controller.js'
import { AdminService } from './admin.service.js'
import { AccountsController, PasswordController } from './accounts.controller.js'
import { AccountsService } from './accounts.service.js'
import { FilesModule } from '../files/files.module.js'
import { DbCatalogReader } from '../catalog/catalog.service.js'
import { DiagnosticsController } from './diagnostics.controller.js'
import { DiagnosticsService } from './diagnostics.service.js'
import { LlmModule } from '../llm/llm.module.js'

@Module({ imports: [FilesModule, LlmModule], controllers: [AdminAssistantsController, AdminCodesController, AdminSettingsController, DiagnosticsController, AccountsController, PasswordController], providers: [AdminService, AccountsService, DiagnosticsService, DbCatalogReader] })
export class AdminModule {}
