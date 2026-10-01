import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { CONFIG, type AppConfig } from '../config/config.js'
import { FileStorageService } from './fileStorage.service.js'
import { FILE_STORAGE, DbFilesService } from './files.service.js'
import { FilesController, TaskFilesController } from './files.controller.js'

@Module({
  imports: [MulterModule.registerAsync({ inject: [CONFIG], useFactory: (config: AppConfig) => ({ limits: { fileSize: config.fileMaxBytes, files: 1 } }) })],
  controllers: [FilesController, TaskFilesController],
  providers: [{ provide: FILE_STORAGE, inject: [CONFIG], useFactory: (config: AppConfig) => new FileStorageService(config.fileStorageRoot) }, DbFilesService],
  exports: [FILE_STORAGE],
})
export class FilesModule {}
