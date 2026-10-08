import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { CONFIG, type AppConfig } from '../config/config.js'
import { FileStorageService } from './fileStorage.service.js'
import { FILE_STORAGE, DbFilesService } from './files.service.js'
import { FilesController, SrFilesController, TaskFilesController } from './files.controller.js'

@Module({
  // defParamCharset: 브라우저는 multipart 파일 이름을 UTF-8 원시 바이트로 보내는데 busboy 기본값은 latin1이라 한글이 깨진다
  imports: [MulterModule.registerAsync({ inject: [CONFIG], useFactory: (config: AppConfig) => ({ limits: { fileSize: config.fileMaxBytes, files: 1 }, defParamCharset: 'utf8' }) })],
  controllers: [FilesController, SrFilesController, TaskFilesController],
  providers: [{ provide: FILE_STORAGE, inject: [CONFIG], useFactory: (config: AppConfig) => new FileStorageService(config.fileStorageRoot) }, DbFilesService],
  exports: [FILE_STORAGE, MulterModule], // 같은 multer 옵션을 쓰는 모듈(에이전트 이미지 업로드)에 전달
})
export class FilesModule {}
