import { Module } from '@nestjs/common'
import { AdminAssistantsController, AdminCodesController, AdminSettingsController } from './admin.controller.js'
import { AdminService } from './admin.service.js'
import { AccountsController, PasswordController } from './accounts.controller.js'
import { AccountsService } from './accounts.service.js'
import { FilesModule } from '../files/files.module.js'
import { DbCatalogReader } from '../catalog/catalog.service.js'

@Module({ imports: [FilesModule], controllers: [AdminAssistantsController, AdminCodesController, AdminSettingsController, AccountsController, PasswordController], providers: [AdminService, AccountsService, DbCatalogReader] })
export class AdminModule {}
